<script lang="ts">
	import { t } from '$lib/i18n'
	import { onMount, onDestroy, tick, untrack } from 'svelte'
	import { getSocket, dmUnreadStore } from '$lib/socket'
	import { apiFetch } from '$lib/api'
	import {
		registerPublicKey, fetchPeerPublicKey,
		encryptDM, decryptDM, loadEsyKey, barbarizeVisual,
		type E2EStatus, type EsyKey
	} from '$lib/e2e'
	import ReactionTooltip from '$lib/components/ReactionTooltip.svelte'
	import EmojiPicker from '$lib/components/EmojiPicker.svelte'
	import MessageBody from '$lib/components/MessageBody.svelte'

	const tFn = $derived($t)

	let { data } = $props()

	interface DmReactionUser {
		username:   string
		name_color: string | null
		created_at: string
	}

	interface DmReaction {
		emoji:     string
		count:     number
		userIds:   string[]
		usernames: string[]
		users?:    DmReactionUser[]  // Layer 1 tooltip vivant : top 8 récents
	}

	interface DmMessage {
		id: string
		conversation_id: string
		sender_id: string
		sender_username: string
		sender_avatar: string | null
		sender_name_color: string | null
		content: string
		created_at: string
		deleted_at: string | null
		is_encrypted?: boolean
		encryption_nonce?: string | null
		edited_at?: string | null
		reactions?: DmReaction[]
		// Texte déchiffré en local (jamais persisté)
		_decrypted?: string
		_decryptFailed?: boolean
		_barbarizing?: boolean
		_barbarText?: string
		_systemMessage?: boolean
	}

	interface Participant {
		id: string
		username: string
		avatar: string | null
		name_color: string | null
	}

	interface Conversation {
		id: string
		is_group: boolean
		group_name: string | null
		participants: Participant[]
		other_id: string
		other_username: string
		other_avatar: string | null
		other_name_color: string | null
	}

	let messages: DmMessage[] = $state(untrack(() => data.messages ?? []))
	let conversations: Conversation[] = $state(untrack(() => data.conversations ?? []))
	let conversation: Conversation | null = $state(untrack(() => data.conversation ?? null))
	let conversationId = $state(untrack(() => data.conversationId))

	// ── E2E state ──────────────────────────────────────────────────────────────
	let e2eStatus = $state<E2EStatus>('unknown')
	let peerPublicKey: string | null = $state(null)
	let esyKey: EsyKey | null = $state(null)
	let esyFingerprint: string | null = $state(null)
	// Animation d'envoi — texte "barbarisé" affiché brièvement avant envoi
	let sendingVisual: string | null = $state(null)

	async function initE2E() {
		if (!conversation) return
		try {
			// 1. Init keypair local + enregistrer sur le serveur
			const registered = await registerPublicKey(data.token)
			if (!registered) {
				e2eStatus = 'inactive'
				return
			}

			// 2. Récupérer la clé publique du peer
			peerPublicKey = await fetchPeerPublicKey(conversation.other_username, data.token)

			// 3. Charger la clé ESY de l'instance
			try {
				esyKey = await loadEsyKey(data.token)
				esyFingerprint = esyKey.fingerprint
			} catch { esyKey = null }

			// 4. Déterminer le statut E2E
			if (peerPublicKey) {
				e2eStatus = 'active'
			} else {
				e2eStatus = 'partial' // moi oui, peer non encore
			}

			// 5. Déchiffrer les messages chiffrés déjà chargés
			await decryptPendingMessages()
		} catch {
			e2eStatus = 'inactive'
		}
	}

	async function decryptPendingMessages() {
		if (!peerPublicKey) return
		// Mémoriser si on était au fond AVANT le re-rendu : si le user lit
		// son historique en haut, on ne veut pas le téléporter en bas après
		// déchiffrement. Sinon, on suit l'élargissement.
		const stickToBottom = isNearBottom()
		const updated = await Promise.all(messages.map(async (m) => {
			if (!m.is_encrypted || !m.encryption_nonce || m._decrypted !== undefined) return m
			const plain = await decryptDM(m.content, m.encryption_nonce, peerPublicKey!, data.token)
			return { ...m, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
		}))
		messages = updated
		if (stickToBottom) {
			await tick()
			scrollToBottom()
		}
	}

	// Quand on switch de conversation
	$effect(() => {
		if (data.conversationId === conversationId) return
		conversationId = data.conversationId
		conversation = data.conversation ?? null
		messages = data.messages ?? []
		hasMore = (data.messages ?? []).length >= 50
		messageInput = ''
		typingLabel = ''
		typingUsers.clear()
		peerPublicKey = null
		e2eStatus = 'unknown'

		sendingVisual = null
		// stickBottom = true et le scroll sont gérés par l'$effect qui dépend
		// de conversationId — il se relance automatiquement ici.
		markRead()
		dmUnreadStore.set(0)
		tick().then(() => { initE2E() })
	})

	let messageInput = $state('')
	let messagesEl: HTMLDivElement | null = $state(null)
	let messagesInnerEl: HTMLDivElement | null = $state(null)
	// Suit-on le bas de la conv ? True par défaut → auto-scroll. Devient false
	// quand l'user remonte de plus de 120px du bas. Repasse true s'il redescend.
	let stickBottom = $state(true)
	let typingUsers: Map<string, { timeout: ReturnType<typeof setTimeout>; username: string }> = new Map()
	let typingLabel = $state('')
	let typingTimeout: ReturnType<typeof setTimeout> | null = null
	let loadingMore = $state(false)
	let hasMore = $state(untrack(() => messages.length >= 50))
	let currentUserId = $state('')
	let sendingMsg = $state(false)
	// Édition inline
	let editingMsgId: string | null = $state(null)
	let editingContent = $state('')

	onMount(async () => {
		const res = await apiFetch(fetch, '/users/me', {
			headers: { Authorization: `Bearer ${data.token}` }
		})
		if (res.ok) {
			const u = await res.json()
			currentUserId = u.user?.id ?? ''
		}

		markRead()
		dmUnreadStore.set(0)
		// Plus besoin de scroll manuel ici : les 3 $effect réactifs s'en
		// occupent (ResizeObserver + dépendance sur conversationId + dépendance
		// sur messages.length). Tout est piloté par le state.

		// Écoute socket DM — attendre que le socket soit prêt si nécessaire
		const attachListeners = (sock: ReturnType<typeof getSocket>) => {
			if (!sock) return
			sock.off('dm:message', onDmMessage)
			sock.off('dm:typing', onDmTyping)
			sock.off('dm:edited', onDmEdited)
			sock.off('dm:deleted', onDmDeleted)
			sock.off('dm:reaction_update', onDmReactionUpdate)
			sock.off('dm:participant_added', onParticipantAdded)
			sock.on('dm:message', onDmMessage)
			sock.on('dm:typing', onDmTyping)
			sock.on('dm:edited', onDmEdited)
			sock.on('dm:deleted', onDmDeleted)
			sock.on('dm:reaction_update', onDmReactionUpdate)
			sock.on('dm:participant_added', onParticipantAdded)
			sock.on('dm:read_ack', () => {})
		}
		const sock = getSocket()
		if (sock) {
			attachListeners(sock)
		} else {
			// Socket pas encore initialisé — poll court jusqu'à disponibilité
			const interval = setInterval(() => {
				const s = getSocket()
				if (s) { clearInterval(interval); attachListeners(s) }
			}, 100)
			setTimeout(() => clearInterval(interval), 5000)
		}

		// Init E2E après le mount
		await initE2E()
	})

	onDestroy(() => {
		const sock = getSocket()
		if (sock) {
			sock.off('dm:message', onDmMessage)
			sock.off('dm:typing', onDmTyping)
		}
		// Cleanup des $effect (ResizeObserver, timeouts) est automatique
		// via les return cleanup de chaque effect.
	})

	async function onDmMessage(msg: DmMessage) {
		if (msg.conversation_id !== conversationId) return

		// On capture wasNear AVANT d'ajouter le message au tableau : si l'user
		// est à 120px ou moins du bas, on considère qu'il suit la conv et on
		// scroll vers le nouveau message. Sinon (lit l'historique), on ne le
		// téléporte pas — on respecte sa lecture.
		const wasNear = isNearBottom()
		const maybeScroll = () => { if (wasNear) scrollToBottom() }

		if (msg.is_encrypted && msg.encryption_nonce && peerPublicKey) {
			// 1. Afficher d'abord le message barbarisé
			if (esyKey) {
				const barbarText = barbarizeVisual(msg.content.slice(0, 40), esyKey, 0.6)
				msg = { ...msg, _barbarizing: true, _barbarText: barbarText }
				messages = [...messages, msg]
				tick().then(maybeScroll)

				// 2. Déchiffrer pendant l'animation (350ms)
				await new Promise(r => setTimeout(r, 350))
				const plain = await decryptDM(msg.content, msg.encryption_nonce!, peerPublicKey, data.token)

				// 3. Remplacer par le texte clair
				messages = messages.map(m =>
					m.id === msg.id
						? { ...m, _barbarizing: false, _barbarText: undefined, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
						: m
				)
				// Le clair peut être plus long que les 40 chars du barbar : re-scroll
				// pour rattraper la nouvelle hauteur si le user était au bas.
				tick().then(maybeScroll)
			} else {
				const plain = await decryptDM(msg.content, msg.encryption_nonce, peerPublicKey, data.token)
				msg = { ...msg, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
				messages = [...messages, msg]
				tick().then(maybeScroll)
			}
		} else {
			messages = [...messages, msg]
			tick().then(maybeScroll)
		}

		if (document.hasFocus()) markRead()
	}

	async function onDmEdited({ msgId, content, conversation_id, encryption_nonce }: { msgId: string; content: string; conversation_id: string; encryption_nonce?: string }) {
		if (conversation_id !== conversationId) return
		const orig = messages.find(m => m.id === msgId)
		const nonce = encryption_nonce ?? orig?.encryption_nonce
		if (orig?.is_encrypted && peerPublicKey && nonce) {
			const plain = await decryptDM(content, nonce, peerPublicKey, data.token)
			messages = messages.map(m => m.id === msgId
				? { ...m, content, encryption_nonce: nonce, _decrypted: plain ?? undefined, _decryptFailed: plain === null, edited_at: new Date().toISOString() }
				: m)
		} else {
			messages = messages.map(m => m.id === msgId ? { ...m, content, edited_at: new Date().toISOString() } : m)
		}
	}

	function onDmDeleted({ msgId, conversation_id }: { msgId: string; conversation_id: string }) {
		if (conversation_id !== conversationId) return
		messages = messages.map(m => m.id === msgId ? { ...m, deleted_at: new Date().toISOString(), content: '' } : m)
	}

	function onDmReactionUpdate({ messageId, reactions }: { messageId: string; reactions: DmReaction[] }) {
		messages = messages.map(m => m.id === messageId ? { ...m, reactions } : m)
	}

	function onParticipantAdded({ conversation_id, user, invited_by }: { conversation_id: string; user: Participant; invited_by: string }) {
		if (conversation_id !== conversationId) return
		if (!conversation) return
		// Ajouter le nouveau participant si pas déjà là
		const already = conversation.participants.find(p => p.id === user.id)
		if (!already) {
			const updated = {
				...conversation,
				is_group: true,
				participants: [...conversation.participants, user],
			}
			conversation = updated
			// Mettre aussi à jour la sidebar conversations
			conversations = conversations.map(c => c.id === conversation_id ? updated : c)
		}
		// Message système local
		messages = [...messages, {
			id: crypto.randomUUID(),
			conversation_id,
			sender_id: '',
			sender_username: '',
			sender_avatar: null,
			sender_name_color: null,
			content: `${invited_by} a ajouté ${user.username} à la conversation`,
			created_at: new Date().toISOString(),
			deleted_at: null,
			_systemMessage: true,
		}]
		tick().then(scrollToBottom)
	}

	// ── Invite panel ────────────────────────────────────────────────────────────
	let showInvite = $state(false)
	let inviteQuery = $state('')
	let inviteResults: Participant[] = $state([])
	let inviteSearching = $state(false)
	let inviteTimeout: ReturnType<typeof setTimeout> | null = null
	let inviting = $state<string | null>(null)  // userId en cours d'invitation

	async function searchInvite(q: string) {
		if (q.trim().length < 2) { inviteResults = []; return }
		inviteSearching = true
		try {
			const res = await apiFetch(fetch, `/users/search?q=${encodeURIComponent(q)}`, {
				headers: { Authorization: `Bearer ${data.token}` }
			})
			if (res.ok) {
				const j = await res.json()
				// Exclure les participants déjà dans la conversation
				const existingIds = new Set([
					currentUserId,
					...(conversation?.participants.map(p => p.id) ?? [])
				])
				inviteResults = (j.users ?? []).filter((u: Participant) => !existingIds.has(u.id))
			}
		} finally { inviteSearching = false }
	}

	function onInviteInput() {
		if (inviteTimeout) clearTimeout(inviteTimeout)
		inviteTimeout = setTimeout(() => searchInvite(inviteQuery), 300)
	}

	async function inviteUser(userId: string) {
		inviting = userId
		try {
			const res = await apiFetch(fetch, `/dm/conversations/${conversationId}/participants`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			})
			if (res.ok) {
				inviteQuery = ''
				inviteResults = []
				showInvite = false
			}
		} finally { inviting = null }
	}

	// ── Composer emoji picker (Layer 3) ────────────────────────────────────
	// Bouton à gauche de la textarea : ouvre un popover EmojiPicker, l'emoji
	// sélectionné est inséré à la position du curseur dans messageInput.
	let composerEmojiOpen = $state(false)
	let messageTextareaEl: HTMLTextAreaElement | null = $state(null)

	function insertEmoji(emoji: string) {
		const ta = messageTextareaEl
		if (!ta) {
			messageInput = messageInput + emoji
			return
		}
		const start = ta.selectionStart ?? messageInput.length
		const end   = ta.selectionEnd   ?? messageInput.length
		messageInput = messageInput.slice(0, start) + emoji + messageInput.slice(end)
		// Replace le curseur juste après l'emoji inséré (sur le tick suivant
		// pour laisser Svelte synchroniser la valeur du textarea).
		const newPos = start + emoji.length
		tick().then(() => {
			ta.focus()
			ta.setSelectionRange(newPos, newPos)
		})
	}

	// Ferme le popover emoji du composer si on clique en dehors.
	$effect(() => {
		if (!composerEmojiOpen) return
		function onDocClick(e: MouseEvent) {
			const el = e.target as HTMLElement
			if (!el.closest('.dm-composer-emoji-btn') && !el.closest('.dm-composer-emoji-popover')) {
				composerEmojiOpen = false
			}
		}
		document.addEventListener('mousedown', onDocClick)
		return () => document.removeEventListener('mousedown', onDocClick)
	})

	// ── Tooltip vivant sur les réactions (Layer 1) ────────────────────────
	// Clé = msg.id + ':' + emoji. Delay 350ms à l'ouverture pour éviter le
	// flash en survol rapide. Delay 120ms à la fermeture pour laisser le
	// temps de glisser la souris du badge vers le tooltip.
	let hoveredDmTooltipKey = $state<string | null>(null)
	let dmTooltipTimer: ReturnType<typeof setTimeout> | null = null
	function openDmTooltip(key: string) {
		if (dmTooltipTimer) clearTimeout(dmTooltipTimer)
		dmTooltipTimer = setTimeout(() => { hoveredDmTooltipKey = key }, 350)
	}
	function closeDmTooltip() {
		if (dmTooltipTimer) clearTimeout(dmTooltipTimer)
		dmTooltipTimer = setTimeout(() => { hoveredDmTooltipKey = null }, 120)
	}

	function toggleReaction(msg: DmMessage, emoji: string) {
		const sock = getSocket()
		if (!sock) return
		sock.emit('dm:react', { messageId: msg.id, emoji })
	}

	// State pour le picker flottant
	let pickerOpenMsgId = $state<string | null>(null)
	const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🔥','🎉','👀']

	function startEdit(msg: DmMessage) {
		editingMsgId = msg.id
		editingContent = msg.is_encrypted ? (msg._decrypted ?? '') : msg.content
	}

	function cancelEdit() {
		editingMsgId = null
		editingContent = ''
	}

	async function saveEdit() {
		const content = editingContent.trim()
		if (!content || !editingMsgId) return
		const sock = getSocket()
		const msgBeingEdited = messages.find(m => m.id === editingMsgId)

		if (msgBeingEdited?.is_encrypted && peerPublicKey) {
			// Re-chiffrer le nouveau contenu
			try {
				const { ciphertext, nonce } = await encryptDM(content, peerPublicKey, data.token)
				if (sock) sock.emit('dm:edit', { msgId: editingMsgId, content: ciphertext, encryption_nonce: nonce })
				// Optimistic local update
				messages = messages.map(m => m.id === editingMsgId
					? { ...m, content: ciphertext, _decrypted: content, edited_at: new Date().toISOString() }
					: m)
			} catch { /* échec chiffrement — annuler */ }
		} else {
			if (sock) sock.emit('dm:edit', { msgId: editingMsgId, content })
		}
		editingMsgId = null
		editingContent = ''
	}

	function onEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
		if (e.key === 'Escape') cancelEdit()
	}

	function onDmTyping({ conversationId: cid, userId, username }: { conversationId: string; userId: string; username: string }) {
		if (cid !== conversationId) return
		if (typingUsers.has(userId)) clearTimeout(typingUsers.get(userId)!.timeout)
		typingUsers.set(userId, {
			username,
			timeout: setTimeout(() => {
				typingUsers.delete(userId)
				updateTypingLabel()
			}, 3000)
		})
		updateTypingLabel()
	}

	function updateTypingLabel() {
		const names = [...typingUsers.values()].map(v => v.username)
		if (names.length === 0) typingLabel = ''
		else if (names.length === 1) typingLabel = tFn('dm.user_typing', { user: names[0] })
		else typingLabel = tFn('dm.users_typing', { users: names.join(', ') })
	}

	function markRead() {
		const sock = getSocket()
		if (sock) sock.emit('dm:read', conversationId)
		apiFetch(fetch, `/dm/conversations/${conversationId}/read`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${data.token}` }
		}).catch(() => {})
	}

	function scrollToBottom() {
		if (!messagesEl) return
		messagesEl.scrollTop = messagesEl.scrollHeight
	}

	function isNearBottom(): boolean {
		if (!messagesEl) return true
		const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight
		return dist < 120
	}

	// ── Auto-scroll réactif via $effect ──────────────────────────────────────
	// Approche 100% réactive : 3 effets indépendants se relancent quand leurs
	// dépendances changent. Plus de orchestration manuelle (pas de
	// setupStickyBottom / scrollToBottom appelés à divers endroits du cycle
	// de vie). Le `if (stickBottom)` à l'intérieur de chaque effet garantit
	// qu'on ne perturbe jamais un user qui lit le passé.

	// Effet 1 : ResizeObserver sur le inner. Capte TOUS les changements de
	// hauteur asynchrones (fonts, images, déchiffrement E2E, nouveaux messages
	// arrivant via socket). Se ré-attache si messagesInnerEl change de réf.
	$effect(() => {
		const inner  = messagesInnerEl
		const outer  = messagesEl
		if (!inner || !outer) return
		if (typeof ResizeObserver === 'undefined') return
		// Debug : expose les éléments dans window pour inspection console
		if (typeof window !== 'undefined') {
			(window as any).__dmDebug = {
				outer, inner,
				probe: () => ({
					outerScrollH: outer.scrollHeight,
					outerClientH: outer.clientHeight,
					outerScrollTop: outer.scrollTop,
					outerOverflowY: getComputedStyle(outer).overflowY,
					outerHeight: getComputedStyle(outer).height,
					innerScrollH: inner.scrollHeight,
					innerOffsetH: inner.offsetHeight,
					stickBottom,
					msgsLength: messages.length,
				}),
				// Remonte tous les parents jusqu'à <html> et affiche leurs
				// dimensions + display + overflow. C'est ce qui va nous dire
				// quel ancêtre casse la chaîne d'overflow.
				parents: () => {
					const out: Array<Record<string, string>> = []
					let el: HTMLElement | null = outer
					while (el && el !== document.documentElement) {
						const cs = getComputedStyle(el)
						out.push({
							tag:        el.tagName.toLowerCase(),
							cls:        (el.className || '').toString().slice(0, 80),
							height:     cs.height,
							minHeight:  cs.minHeight,
							display:    cs.display,
							flex:       cs.flex || cs.flexGrow,
							overflow:   cs.overflowY,
							scrollH:    String(el.scrollHeight),
							clientH:    String(el.clientHeight),
						})
						el = el.parentElement
					}
					// + html et body pour completion
					const html = document.documentElement
					const body = document.body
					out.push({ tag: 'body', cls: '(body)', height: getComputedStyle(body).height, minHeight: getComputedStyle(body).minHeight, display: getComputedStyle(body).display, flex: '', overflow: getComputedStyle(body).overflowY, scrollH: String(body.scrollHeight), clientH: String(body.clientHeight) })
					out.push({ tag: 'html', cls: '(html)', height: getComputedStyle(html).height, minHeight: getComputedStyle(html).minHeight, display: getComputedStyle(html).display, flex: '', overflow: getComputedStyle(html).overflowY, scrollH: String(html.scrollHeight), clientH: String(html.clientHeight) })
					console.table(out)
					return out
				},
				forceScroll: () => { outer.scrollTop = outer.scrollHeight; return outer.scrollTop },
			}
		}
		const ro = new ResizeObserver(() => {
			if (stickBottom) outer.scrollTop = outer.scrollHeight
		})
		ro.observe(inner)
		return () => ro.disconnect()
	})

	// Effet 2 : reset stickBottom + scroll à chaque changement de conversation.
	// Lance plusieurs scrolls successifs en rAF + setTimeout pour absorber les
	// délais de rendu (mount, hydration, déchiffrement initial).
	$effect(() => {
		// dépendance explicite sur conversationId : se relance quand on
		// change de DM via la sidebar (ce qui re-render le contenu).
		conversationId
		stickBottom = true
		if (!messagesEl) return
		const el = messagesEl
		const stick = () => { if (stickBottom) el.scrollTop = el.scrollHeight }
		// Cascade de scrolls : immédiat, après 1 rAF, après tick browser, et
		// 3 tirs de sécurité jusqu'à 400ms pour les late layouts (E2E, images).
		stick()
		requestAnimationFrame(stick)
		const t1 = setTimeout(stick, 50)
		const t2 = setTimeout(stick, 200)
		const t3 = setTimeout(stick, 400)
		return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
	})

	// Effet 3 : à chaque ajout/modif de message, si on suit le bas, on scroll.
	// La dépendance sur messages.length déclenche le re-scroll même si le
	// ResizeObserver n'a pas encore réagi (sécurité supplémentaire).
	$effect(() => {
		messages.length
		if (!stickBottom || !messagesEl) return
		const el = messagesEl
		requestAnimationFrame(() => {
			if (stickBottom) el.scrollTop = el.scrollHeight
		})
	})

	async function loadMore() {
		if (loadingMore || !hasMore || messages.length === 0) return
		loadingMore = true
		const oldest = messages[0].created_at
		try {
			const res = await apiFetch(fetch, `/dm/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(oldest)}`, {
				headers: { Authorization: `Bearer ${data.token}` }
			})
			if (res.ok) {
				const { messages: older } = await res.json()
				if (older.length === 0) { hasMore = false; return }
				const prevScrollHeight = messagesEl?.scrollHeight ?? 0
				// Déchiffrer les anciens messages
				const decrypted = await Promise.all((older as DmMessage[]).map(async (m) => {
					if (!m.is_encrypted || !m.encryption_nonce || !peerPublicKey) return m
					const plain = await decryptDM(m.content, m.encryption_nonce, peerPublicKey, data.token)
					return { ...m, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
				}))
				messages = [...decrypted, ...messages]
				hasMore = older.length >= 50
				await tick()
				if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight - prevScrollHeight
			}
		} finally {
			loadingMore = false
		}
	}

	function onScroll() {
		if (!messagesEl) return
		// Met à jour stickBottom selon la position : on suit si dans les 120px
		// du bas. Au-delà, l'auto-scroll est désactivé jusqu'à ce que l'user
		// redescende. Le seuil 120px évite le yo-yo si on est à ~2-3 lignes
		// du bas (typique après auto-scroll d'un message reçu).
		const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight
		stickBottom = dist < 120

		if (messagesEl.scrollTop < 80) loadMore()
	}

	function emitTyping() {
		const sock = getSocket()
		if (!sock || typingTimeout) return
		sock.emit('dm:typing', conversationId)
		typingTimeout = setTimeout(() => { typingTimeout = null }, 2000)
	}

	async function sendMessage() {
		const content = messageInput.trim()
		if (!content || sendingMsg) return
		sendingMsg = true
		messageInput = ''

		try {
			const sock = getSocket()

			if (e2eStatus === 'active' && peerPublicKey) {
				// ── E2E : animation barbare → chiffrement → envoi ──────────────
				// 1. Afficher l'animation barbare pendant le chiffrement
				if (esyKey) {
					sendingVisual = barbarizeVisual(content, esyKey)
					await tick()
					await new Promise(r => setTimeout(r, 350))
				}

				const { ciphertext, nonce } = await encryptDM(content, peerPublicKey, data.token)
				sendingVisual = null

				if (sock) {
					sock.emit('dm:send', {
						conversationId,
						content: ciphertext,
						is_encrypted: true,
						encryption_nonce: nonce,
					})
				}
			} else {
				// ── Fallback texte clair ────────────────────────────────────────
				if (sock) {
					sock.emit('dm:send', { conversationId, content })
				}
			}
		} finally {
			sendingMsg = false
			sendingVisual = null
			await tick()
			scrollToBottom()
		}
	}

	async function deleteMessage(msgId: string) {
		await apiFetch(fetch, `/dm/messages/${msgId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${data.token}` }
		})
		messages = messages.map(m => m.id === msgId ? { ...m, deleted_at: new Date().toISOString(), content: '' } : m)
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			sendMessage()
		}
	}

	function formatTime(iso: string): string {
		const d = new Date(iso)
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}

	function formatDate(iso: string): string {
		const d = new Date(iso)
		const now = new Date()
		if (d.toDateString() === now.toDateString()) return tFn('common.today')
		const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
		if (d.toDateString() === yesterday.toDateString()) return tFn('common.yesterday')
		return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
	}

	// Message texte à afficher (déchiffré si E2E, brut sinon)
	function displayContent(msg: DmMessage): string {
		if (msg.is_encrypted) {
			if (msg._barbarizing && msg._barbarText) return msg._barbarText
			if (msg._decrypted !== undefined) return msg._decrypted
			if (msg._decryptFailed) return tFn('dm.decrypt_failed')
			return '…'
		}
		return msg.content
	}

	let groupedMessages = $derived.by(() => {
		const groups: { date: string; msgs: DmMessage[] }[] = []
		let currentDate = ''
		for (const m of messages) {
			const d = formatDate(m.created_at)
			if (d !== currentDate) {
				currentDate = d
				groups.push({ date: d, msgs: [] })
			}
			groups[groups.length - 1].msgs.push(m)
		}
		return groups
	})

	function isFirstInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === 0) return true
		return msgs[i].sender_id !== msgs[i - 1].sender_id
	}
	function isLastInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === msgs.length - 1) return true
		return msgs[i].sender_id !== msgs[i + 1].sender_id
	}

	function convLabel(conv: Conversation): string {
		if (conv.is_group) {
			return conv.group_name ?? conv.participants.map(p => p.username).join(', ')
		}
		return conv.other_username
	}

	// Couleurs du shield E2E
	const shieldColor = $derived(
		e2eStatus === 'active'   ? { dot: '#4ade80', glow: 'rgba(74,222,128,0.25)', label: 'E2E' } :
		e2eStatus === 'partial'  ? { dot: '#fb923c', glow: 'rgba(251,146,60,0.25)',  label: '~E2E' } :
		e2eStatus === 'inactive' ? { dot: '#6b7280', glow: 'transparent',            label: '' } :
		                           { dot: '#374151', glow: 'transparent',            label: '' }
	)
</script>

<svelte:head>
	<title>DM — {conversation ? convLabel(conversation) : tFn('dm.title')}</title>
</svelte:head>

<!-- Layout deux colonnes : sidebar + zone chat -->
<!-- height: 100dvh en style inline (pas h-full) : on ne dépend plus de la
     chaîne flex parent qui explose à cause du min-h-screen du +layout global.
     Le DM page se borne lui-même au viewport, et son scroll interne marche. -->
<div class="flex bg-gray-950/20 min-h-0" style="height: 100dvh; max-height: 100dvh">

	<!-- ── Sidebar conversations ──────────────────────────────────────────── -->
	<aside class="hidden sm:flex flex-col w-72 shrink-0 border-r border-white/[0.06] bg-gray-950/60">

		<!-- Header sidebar -->
		<div class="px-4 pt-4 pb-3">
			<div class="flex items-center justify-between mb-3">
				<a href="/dm" class="flex items-center gap-2 group">
					<svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
					</svg>
					<span class="text-xs font-semibold text-gray-500 group-hover:text-gray-300 uppercase tracking-wider transition-colors">{tFn('dm.sidebar_title')}</span>
				</a>
				<a href="/dm" class="w-6 h-6 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 border border-indigo-500/20 flex items-center justify-center transition-colors" title={tFn('dm.new_conversation_tooltip')}>
					<svg class="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
					</svg>
				</a>
			</div>
		</div>

		<!-- Liste -->
		<div class="flex-1 overflow-y-auto px-2 pb-3" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.04) transparent">
			{#each conversations as conv}
				<a href="/dm/{conv.id}"
					class="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl mb-0.5 transition-all
						{conv.id === conversationId
							? 'bg-indigo-600/15 border border-indigo-500/20'
							: 'hover:bg-white/[0.04] border border-transparent'}">
					<!-- Avatar(s) -->
					<div class="relative shrink-0">
						{#if conv.is_group}
							<div class="w-8 h-8 relative">
								{#each conv.participants.slice(0, 2) as p, i}
									{#if p.avatar}
										<img src={p.avatar} alt={p.username}
											class="w-5 h-5 rounded-full object-cover absolute border border-gray-950"
											style={i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}/>
									{:else}
										<div class="w-5 h-5 rounded-full bg-indigo-600/30 border border-gray-950 flex items-center justify-center text-[9px] font-bold absolute"
											style={`${i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}; color: ${p.name_color ?? '#818cf8'}`}>
											{p.username[0].toUpperCase()}
										</div>
									{/if}
								{/each}
							</div>
						{:else if conv.other_avatar}
							<img src={conv.other_avatar} alt={conv.other_username} class="w-8 h-8 rounded-full object-cover"/>
						{:else}
							<div class="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/15 flex items-center justify-center text-xs font-bold"
								style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: #818cf8'}>
								{(conv.other_username ?? '?')[0].toUpperCase()}
							</div>
						{/if}
					</div>
					<span class="text-sm font-medium truncate
						{conv.id === conversationId ? 'text-white' : 'text-gray-400'}"
						style={conv.id === conversationId && !conv.is_group && conv.other_name_color ? `color: ${conv.other_name_color}` : ''}>
						{convLabel(conv)}
					</span>
				</a>
			{/each}
		</div>
	</aside>

	<!-- ── Zone principale ───────────────────────────────────────────────── -->
	<!-- min-h-0 CRITIQUE : sans ça, ce flex-item se laisse pousser par son
	     contenu (height = auto) et l'overflow-y-auto du child #messagesEl
	     n'a plus rien à scroller. Symptôme : scrollHeight == clientHeight.
	     C'est le bug flexbox le plus connu, et c'est ce qui empêchait
	     l'auto-scroll en bas de fonctionner depuis 3 tentatives. -->
	<div class="flex-1 flex flex-col min-w-0 min-h-0">

		<!-- Header conversation -->
		<header class="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] bg-gray-950/40 backdrop-blur-sm">
			<!-- Retour mobile -->
			<a href="/dm" aria-label={tFn('dm.back')} class="sm:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-gray-500 hover:text-white transition-colors">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
				</svg>
			</a>

			{#if conversation}
				{#if conversation.is_group}
					<!-- Avatar groupe (stack) -->
					<div class="w-9 h-9 relative shrink-0">
						{#each conversation.participants.slice(0, 2) as p, i}
							{#if p.avatar}
								<img src={p.avatar} alt={p.username}
									class="w-6 h-6 rounded-full object-cover absolute border-2 border-gray-950"
									style={i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}/>
							{:else}
								<div class="w-6 h-6 rounded-full bg-indigo-600/30 border-2 border-gray-950 flex items-center justify-center text-[10px] font-bold absolute"
									style={`${i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}; color: ${p.name_color ?? '#818cf8'}`}>
									{p.username[0].toUpperCase()}
								</div>
							{/if}
						{/each}
					</div>

					<!-- Nom groupe + membres -->
					<div class="flex-1 min-w-0">
						<span class="text-sm font-semibold text-white block truncate">{convLabel(conversation)}</span>
						<span class="text-[11px] text-gray-600">{conversation.participants.length + 1} {tFn('dm.members')}</span>
					</div>

					<!-- Bouton inviter -->
					<div class="relative shrink-0">
						<button
							onclick={() => showInvite = !showInvite}
							class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors
								{showInvite ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'bg-white/[0.05] hover:bg-white/[0.09] text-gray-400 hover:text-white border border-white/[0.08]'}"
							title={tFn('dm.invite_member')}
						>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
							</svg>
							{tFn('dm.invite_member')}
						</button>

						<!-- Dropdown invite -->
						{#if showInvite}
							<div class="absolute top-full right-0 mt-1.5 w-64 bg-gray-900 border border-white/[0.08] rounded-xl shadow-2xl z-30 p-3">
								<p class="text-[11px] text-gray-500 font-semibold uppercase tracking-wider mb-2">{tFn('dm.invite_member')}</p>
								<div class="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 focus-within:border-indigo-500/40 transition-all mb-2">
									<svg class="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
									</svg>
									<input
										type="text"
										bind:value={inviteQuery}
										oninput={onInviteInput}
										placeholder={tFn('dm.search_placeholder')}
										class="flex-1 bg-transparent text-xs text-white placeholder-gray-600 outline-none"
									/>
									{#if inviteSearching}
										<div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
									{/if}
								</div>
								{#if inviteResults.length > 0}
									<div class="space-y-0.5 max-h-40 overflow-y-auto">
										{#each inviteResults as u}
											<button
												onclick={() => inviteUser(u.id)}
												disabled={inviting === u.id}
												class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left disabled:opacity-50"
											>
												{#if u.avatar}
													<img src={u.avatar} alt={u.username} class="w-6 h-6 rounded-full object-cover shrink-0"/>
												{:else}
													<div class="w-6 h-6 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-[10px] font-bold text-indigo-300">
														{u.username[0].toUpperCase()}
													</div>
												{/if}
												<span class="text-sm text-white flex-1 truncate">{u.username}</span>
												{#if inviting === u.id}
													<div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
												{/if}
											</button>
										{/each}
									</div>
								{:else if inviteQuery.trim().length >= 2 && !inviteSearching}
									<p class="text-xs text-gray-600 text-center py-2">{tFn('search.no_results')}</p>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<!-- Avatar 1:1 -->
					{#if conversation.other_avatar}
						<img src={conversation.other_avatar} alt={conversation.other_username} class="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/[0.06]"/>
					{:else}
						<div class="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center shrink-0 text-sm font-bold"
							style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: #818cf8'}>
							{(conversation.other_username ?? '?')[0].toUpperCase()}
						</div>
					{/if}

					<!-- Nom + lien profil -->
					<div class="flex-1 min-w-0">
						<a href="/users/{conversation.other_username}"
							class="text-sm font-semibold hover:underline block truncate"
							style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: white'}>
							{conversation.other_username}
						</a>
						<span class="text-[11px] text-gray-600">{tFn('dm.private_message')}</span>
					</div>

					<!-- Lien profil icône -->
					<a href="/users/{conversation.other_username}" aria-label={tFn('dm.view_profile')} class="p-1.5 rounded-lg hover:bg-white/[0.06] text-gray-600 hover:text-gray-300 transition-colors shrink-0">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
						</svg>
					</a>

					<!-- Shield E2E -->
					{#if e2eStatus !== 'inactive' && e2eStatus !== 'unknown'}
						<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border shrink-0 cursor-default"
							style="background: {shieldColor.glow}; border-color: {shieldColor.dot}30"
							title={esyFingerprint ? `ESY: ${esyFingerprint}` : tFn('dm.e2e_tooltip_' + e2eStatus)}>
							<span class="relative flex w-2 h-2">
								<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
									style="background: {shieldColor.dot}"></span>
								<span class="relative inline-flex rounded-full w-2 h-2"
									style="background: {shieldColor.dot}"></span>
							</span>
							<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
								style="color: {shieldColor.dot}">
								<rect x="5" y="11" width="14" height="10" rx="2"/>
								<path d="M8 11V7a4 4 0 018 0v4"/>
							</svg>
							{#if shieldColor.label}
								<span class="text-[10px] font-bold tracking-wider"
									style="color: {shieldColor.dot}">{shieldColor.label}</span>
							{/if}
						</div>
					{/if}

					<!-- Bouton inviter (1:1 → convertir en groupe) -->
					<div class="relative shrink-0">
						<button
							onclick={() => showInvite = !showInvite}
							class="p-1.5 rounded-lg transition-colors
								{showInvite ? 'bg-indigo-600/20 text-indigo-400' : 'hover:bg-white/[0.06] text-gray-600 hover:text-gray-300'}"
							title={tFn('dm.invite_member')}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
							</svg>
						</button>

						<!-- Dropdown invite -->
						{#if showInvite}
							<div class="absolute top-full right-0 mt-1.5 w-64 bg-gray-900 border border-white/[0.08] rounded-xl shadow-2xl z-30 p-3">
								<p class="text-[11px] text-gray-500 font-semibold uppercase tracking-wider mb-2">{tFn('dm.invite_member')}</p>
								<div class="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 focus-within:border-indigo-500/40 transition-all mb-2">
									<svg class="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
									</svg>
									<input
										type="text"
										bind:value={inviteQuery}
										oninput={onInviteInput}
										placeholder={tFn('dm.search_placeholder')}
										class="flex-1 bg-transparent text-xs text-white placeholder-gray-600 outline-none"
									/>
									{#if inviteSearching}
										<div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
									{/if}
								</div>
								{#if inviteResults.length > 0}
									<div class="space-y-0.5 max-h-40 overflow-y-auto">
										{#each inviteResults as u}
											<button
												onclick={() => inviteUser(u.id)}
												disabled={inviting === u.id}
												class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left disabled:opacity-50"
											>
												{#if u.avatar}
													<img src={u.avatar} alt={u.username} class="w-6 h-6 rounded-full object-cover shrink-0"/>
												{:else}
													<div class="w-6 h-6 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-[10px] font-bold text-indigo-300">
														{u.username[0].toUpperCase()}
													</div>
												{/if}
												<span class="text-sm text-white flex-1 truncate">{u.username}</span>
												{#if inviting === u.id}
													<div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
												{/if}
											</button>
										{/each}
									</div>
								{:else if inviteQuery.trim().length >= 2 && !inviteSearching}
									<p class="text-xs text-gray-600 text-center py-2">{tFn('search.no_results')}</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</header>

		<!-- Messages -->
		<div
			bind:this={messagesEl}
			onscroll={onScroll}
			data-dm-messages
			class="flex-1 overflow-y-auto px-5 py-4 min-h-0"
			style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.06) transparent"
		>
		<!-- Wrapper interne : c'est lui qu'on observe pour le ResizeObserver,
		     car il reflète la hauteur réelle du contenu (scrollHeight). -->
		<div bind:this={messagesInnerEl}>
			{#if loadingMore}
				<div class="flex justify-center py-4">
					<div class="w-4 h-4 border-2 border-indigo-400/60 border-t-transparent rounded-full animate-spin"></div>
				</div>
			{/if}

			{#each groupedMessages as group}
				<!-- Séparateur de date -->
				<div class="flex items-center gap-3 py-4">
					<div class="flex-1 h-px bg-white/[0.05]"></div>
					<span class="text-[10px] text-gray-700 font-semibold uppercase tracking-wider shrink-0 px-2">{group.date}</span>
					<div class="flex-1 h-px bg-white/[0.05]"></div>
				</div>

				{#each group.msgs as msg, i}
					{@const isMine = msg.sender_id === currentUserId}
					{@const first = isFirstInGroup(group.msgs, i)}
					{@const last = isLastInGroup(group.msgs, i)}

					{#if msg._systemMessage}
						<div class="flex items-center gap-3 py-2">
							<div class="flex-1 h-px bg-white/[0.04]"></div>
							<span class="text-[10px] text-gray-600 italic px-2 shrink-0">{msg.content}</span>
							<div class="flex-1 h-px bg-white/[0.04]"></div>
						</div>
					{:else}

					<div class="flex {isMine ? 'justify-end' : 'justify-start'} {first ? 'mt-3' : 'mt-[2px]'} group/msg">
						<!-- Avatar peer (dernier du groupe seulement) -->
						{#if !isMine}
							<div class="w-9 shrink-0 mr-2 self-end mb-0.5">
								{#if last}
									{#if msg.sender_avatar}
										<img src={msg.sender_avatar} alt={msg.sender_username} class="w-7 h-7 rounded-full object-cover"/>
									{:else}
										<div class="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/15 flex items-center justify-center text-xs font-bold"
											style={msg.sender_name_color ? `color: ${msg.sender_name_color}` : 'color: #818cf8'}>
											{msg.sender_username[0].toUpperCase()}
										</div>
									{/if}
								{/if}
							</div>
						{/if}

						<div class="max-w-[68%] flex flex-col {isMine ? 'items-end' : 'items-start'}">
							<!-- Actions hover (edit/delete pour les miens + réaction pour tous) -->
							{#if !msg.deleted_at && editingMsgId !== msg.id}
								<div class="flex gap-0.5 mb-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
									{#if isMine}
										<button onclick={() => startEdit(msg)}
											class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-indigo-400 transition-colors"
											title={tFn('common.edit')}>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
												<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
											</svg>
										</button>
										<button onclick={() => deleteMessage(msg.id)}
											class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-red-400 transition-colors"
											title={tFn('common.delete')}>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
											</svg>
										</button>
									{/if}
									<!-- Bouton réaction -->
									<button
										onclick={() => pickerOpenMsgId = pickerOpenMsgId === msg.id ? null : msg.id}
										class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-yellow-400 transition-colors"
										title="Réagir">
										<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<circle cx="12" cy="12" r="10"/>
											<path d="M8 13s1.5 2 4 2 4-2 4-2"/>
											<line x1="9" y1="9" x2="9.01" y2="9" stroke-linecap="round" stroke-width="2.5"/>
											<line x1="15" y1="9" x2="15.01" y2="9" stroke-linecap="round" stroke-width="2.5"/>
										</svg>
									</button>
								</div>
							{/if}

							<!-- Quick emoji picker -->
							{#if pickerOpenMsgId === msg.id}
								<div class="dm-picker flex items-center gap-0.5 px-1.5 py-1 rounded-xl mb-1
								            {isMine ? 'self-end' : 'self-start'}"
								     style="background: #1a1a2e; border: 1px solid rgba(255,255,255,.1)">
									{#each QUICK_EMOJIS as emoji}
										<button
											onclick={() => { toggleReaction(msg, emoji); pickerOpenMsgId = null; }}
											class="dm-picker-emoji w-7 h-7 flex items-center justify-center rounded-lg text-base transition-all hover:scale-125 hover:bg-white/[0.08]"
											title={emoji}>
											{emoji}
										</button>
									{/each}
								</div>
							{/if}

							{#if msg.deleted_at}
								<div class="px-3 py-2 rounded-2xl text-xs italic text-gray-700 bg-white/[0.03] border border-white/[0.05]">
									{tFn('dm.deleted_message')}
								</div>
							{:else}
								<div class="relative px-3.5 py-2 text-sm break-words leading-relaxed
									{msg._barbarizing ? 'font-mono tracking-widest opacity-60 animate-pulse' : ''}
									{isMine
										? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/10 '
											+ (first ? 'rounded-t-2xl rounded-bl-2xl rounded-br-md' : last ? 'rounded-b-2xl rounded-tl-2xl rounded-tr-md' : 'rounded-l-2xl rounded-r-md')
										: 'bg-white/[0.07] border border-white/[0.06] text-gray-100 '
											+ (first ? 'rounded-t-2xl rounded-br-2xl rounded-bl-md' : last ? 'rounded-b-2xl rounded-tr-2xl rounded-tl-md' : 'rounded-r-2xl rounded-l-md')}">
									{#if editingMsgId === msg.id}
									<!-- Mode édition inline -->
									<textarea
										bind:value={editingContent}
										onkeydown={onEditKeydown}
										rows="1"
										class="w-full bg-transparent outline-none resize-none text-sm text-white leading-relaxed"
										style="field-sizing: content;"
									></textarea>
									<div class="flex gap-1.5 mt-1.5">
										<button onclick={saveEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">Entrée</button>
										<button onclick={cancelEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-gray-400 transition-colors">Échap</button>
									</div>
								{:else}
									<MessageBody text={displayContent(msg)} />

									<!-- Lock badge si message chiffré -->
									{#if msg.is_encrypted && !msg._decryptFailed}
										<span class="inline-flex items-center ml-1.5 opacity-50" title={tFn('dm.encrypted_message')}>
											<svg class="w-2.5 h-2.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
												<rect x="5" y="11" width="14" height="10" rx="2"/>
												<path d="M8 11V7a4 4 0 018 0v4"/>
											</svg>
										</span>
									{/if}

								{/if}
								</div>

								<!-- Reaction pills -->
								{#if msg.reactions && msg.reactions.length > 0}
									<div class="flex flex-wrap gap-1 mt-1 {isMine ? 'justify-end' : 'justify-start'}">
										{#each msg.reactions as r (r.emoji)}
											{@const iReacted = r.userIds.includes(currentUserId)}
											{@const tooltipKey = msg.id + ':' + r.emoji}
											<div class="relative inline-block"
											     onmouseenter={() => openDmTooltip(tooltipKey)}
											     onmouseleave={closeDmTooltip}
											     role="presentation">
												<button
													onclick={() => toggleReaction(msg, r.emoji)}
													onfocus={() => openDmTooltip(tooltipKey)}
													onblur={closeDmTooltip}
													class="dm-reaction-pill flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all
													       {iReacted ? 'dm-reaction-mine' : 'dm-reaction-other'}"
													title="">
													<span>{r.emoji}</span>
													<span class="font-semibold tabular-nums">{r.count}</span>
												</button>
												{#if hoveredDmTooltipKey === tooltipKey && r.users && r.users.length > 0}
													<ReactionTooltip
														users={r.users}
														total={r.count}
														emoji={r.emoji}
														anchor="top"
													/>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							{/if}

							{#if last}
								<span class="text-[10px] text-gray-700 mt-1 px-1">
									{formatTime(msg.created_at)}
									{#if msg.edited_at}<span class="italic"> · {tFn('common.edited')}</span>{/if}
								</span>
							{/if}
						</div>
					</div>
					{/if}
				{/each}
			{/each}

			<!-- Indicateur de frappe -->
			{#if typingLabel}
				<div class="flex items-end gap-2 px-3 pb-2 mt-1" aria-live="polite">
					<!-- Avatar (premier peer ou groupe) -->
					{#if conversation?.is_group}
						{#if conversation.participants[0]?.avatar}
							<img src={conversation.participants[0].avatar} alt="" class="w-5 h-5 rounded-full object-cover shrink-0 mb-0.5 opacity-70" />
						{:else}
							<div class="w-5 h-5 rounded-full shrink-0 mb-0.5 opacity-70 flex items-center justify-center text-[8px] font-bold text-white"
							     style="background: #4f46e5">{conversation.participants[0]?.username?.[0]?.toUpperCase() ?? '?'}</div>
						{/if}
					{:else if conversation?.other_avatar}
						<img src={conversation.other_avatar} alt="" class="w-5 h-5 rounded-full object-cover shrink-0 mb-0.5 opacity-70" />
					{:else}
						<div class="w-5 h-5 rounded-full shrink-0 mb-0.5 opacity-70 flex items-center justify-center text-[8px] font-bold text-white"
						     style="background: #4f46e5">{conversation?.other_username?.[0]?.toUpperCase() ?? '?'}</div>
					{/if}
					<!-- Bulle dots -->
					<div class="dm-typing-bubble flex items-center gap-[3px] px-3 py-2 rounded-2xl rounded-bl-sm">
						<span class="dm-dot" style="animation-delay: 0ms"></span>
						<span class="dm-dot" style="animation-delay: 150ms"></span>
						<span class="dm-dot" style="animation-delay: 300ms"></span>
					</div>
					<span class="text-[10px] text-gray-700 mb-1 italic">{typingLabel}</span>
				</div>
			{/if}
		</div>
		</div>

		<!-- Zone de saisie -->
		<div class="shrink-0 px-5 py-4 border-t border-white/[0.06] bg-gray-950/30">
			<!-- Animation barbare d'envoi -->
			{#if sendingVisual}
				<div class="mb-2 px-3 py-1.5 rounded-xl bg-indigo-900/20 border border-indigo-500/15 text-xs font-mono text-indigo-300/60 truncate tracking-widest animate-pulse">
					{sendingVisual}
				</div>
			{/if}
			<div class="flex items-end gap-3 bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 py-3
						focus-within:border-indigo-500/35 focus-within:bg-indigo-500/[0.04] transition-all duration-200">
				<!-- Bouton emoji picker (Layer 3) — insère à la position du curseur -->
				<div class="relative shrink-0">
					<button
						type="button"
						onclick={(e) => { e.stopPropagation(); composerEmojiOpen = !composerEmojiOpen }}
						class="dm-composer-emoji-btn w-8 h-8 rounded-xl flex items-center justify-center
						       text-gray-500 hover:text-gray-200 hover:bg-white/[0.06]
						       transition-all duration-150"
						title={tFn('common.add_emoji') ?? 'Insérer un emoji'}
						aria-label="Insérer un emoji"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="9"/>
							<path stroke-linecap="round" d="M8 14s1.5 2 4 2 4-2 4-2"/>
							<line x1="9" y1="9" x2="9.01" y2="9"/>
							<line x1="15" y1="9" x2="15.01" y2="9"/>
						</svg>
					</button>
					{#if composerEmojiOpen}
						<div class="dm-composer-emoji-popover">
							<EmojiPicker onselect={(e) => { insertEmoji(e); composerEmojiOpen = false }} />
						</div>
					{/if}
				</div>
				<textarea
					bind:this={messageTextareaEl}
					bind:value={messageInput}
					onkeydown={onKeydown}
					oninput={emitTyping}
					placeholder={conversation ? tFn('dm.message_placeholder_user', { user: convLabel(conversation) }) : tFn('dm.message_placeholder')}
					rows="1"
					class="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none resize-none max-h-36 leading-relaxed"
					style="field-sizing: content;"
				></textarea>
				<button
					onclick={sendMessage}
					disabled={!messageInput.trim() || sendingMsg}
					class="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center
						bg-indigo-600 hover:bg-indigo-500 disabled:opacity-25 disabled:cursor-not-allowed
						transition-all duration-150 shadow-lg shadow-indigo-500/20"
					title={tFn('common.send')}
				>
					<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
						<line x1="22" y1="2" x2="11" y2="13"/>
						<polygon points="22 2 15 22 11 13 2 9 22 2"/>
					</svg>
				</button>
			</div>
			<p class="text-[10px] text-gray-800 mt-1.5 text-right">{tFn('dm.send_instructions')}</p>
		</div>

	</div>
</div>

<style>
/* ── Composer emoji popover (Layer 3) ─────────────────────────────────────── */
.dm-composer-emoji-popover {
	position: absolute;
	bottom: calc(100% + 8px);
	left: 0;
	z-index: 50;
	background: rgba(15, 15, 22, 0.98);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 12px;
	box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
	animation: dm-emoji-pop 0.18s cubic-bezier(.2, .8, .25, 1) both;
	transform-origin: bottom left;
}
@keyframes dm-emoji-pop {
	from { opacity: 0; transform: translateY(6px) scale(.96); }
	to   { opacity: 1; transform: translateY(0)    scale(1);   }
}

/* ── Reaction pills ───────────────────────────────────────────────────────── */
.dm-reaction-pill {
	border: 1px solid rgba(255,255,255,.08);
	background: rgba(255,255,255,.04);
	color: #9ca3af;
	animation: pill-pop .2s cubic-bezier(.34,1.56,.64,1) both;
	cursor: pointer;
}
.dm-reaction-pill:hover {
	border-color: rgba(99,102,241,.4);
	background: rgba(99,102,241,.12);
	color: #e2e8f0;
	transform: scale(1.08);
}
.dm-reaction-mine {
	border-color: rgba(99,102,241,.5);
	background: rgba(99,102,241,.18);
	color: #c7d2fe;
}
.dm-reaction-mine:hover {
	background: rgba(99,102,241,.08);
	border-color: rgba(99,102,241,.25);
}
@keyframes pill-pop {
	from { transform: scale(0); opacity: 0; }
	to   { transform: scale(1); opacity: 1; }
}

/* ── Typing indicator ────────────────────────────────────────────────────── */
.dm-typing-bubble {
	background: rgba(255,255,255,.06);
	border: 1px solid rgba(255,255,255,.07);
	animation: bubble-in .2s cubic-bezier(.16,1,.3,1) both;
}
@keyframes bubble-in {
	from { transform: scale(.8) translateY(6px); opacity: 0; }
	to   { transform: scale(1) translateY(0);    opacity: 1; }
}
.dm-dot {
	display: inline-block;
	width: 5px; height: 5px;
	border-radius: 50%;
	background: #6b7280;
	animation: dot-bounce 1.2s ease-in-out infinite both;
}
@keyframes dot-bounce {
	0%, 80%, 100% { transform: translateY(0);    background: #4b5563; }
	40%           { transform: translateY(-5px); background: #a78bfa; }
}

/* ── Emoji picker ─────────────────────────────────────────────────────────── */
.dm-picker {
	animation: picker-in .15s cubic-bezier(.16,1,.3,1) both;
	box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
@keyframes picker-in {
	from { transform: scale(.85) translateY(4px); opacity: 0; }
	to   { transform: scale(1) translateY(0);     opacity: 1; }
}
.dm-picker-emoji {
	transition: transform .1s, background .1s;
}
</style>
