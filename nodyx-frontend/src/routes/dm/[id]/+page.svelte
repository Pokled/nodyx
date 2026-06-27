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
	import { shouldOfferRestore, hasServerBackup } from '$lib/e2eBackupClient'
	import E2EKeyBackup from '$lib/components/E2EKeyBackup.svelte'
	import ReactionTooltip from '$lib/components/ReactionTooltip.svelte'
	import EmojiPicker from '$lib/components/EmojiPicker.svelte'
	import MessageBody from '$lib/components/MessageBody.svelte'
	import AudioRecorder from '$lib/components/AudioRecorder.svelte'

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

	interface DmReplySnapshot {
		id:              string
		sender_username: string
		content:         string
		is_encrypted:    boolean
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
		reply_to_id?:   string | null
		reply_snapshot?: DmReplySnapshot | null
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
		created_at?: string
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
	// Restauration de clé sur nouvel appareil (backup serveur présent, pas de clé locale)
	let showRestore = $state(false)
	let restoreDismissed = $state(false)
	// Bandeau pédagogique E2E (chiffré, pense à sauvegarder ta clé)
	let showE2eBanner = $state(false)
	let hasBackup     = $state(false)
	// Garde-fou avant envoi : alerte si pas de sauvegarde de clé
	let showSendGuard = $state(false)
	let sendGuardAck  = $state(false)
	// Des messages n'ont pas pu être déchiffrés (clé locale ne correspond pas)
	let decryptFailed = $derived(messages.some((m) => m._decryptFailed))

	function dismissE2eBanner() {
		showE2eBanner = false
		try { localStorage.setItem('nodyx_e2e_banner_dismissed', '1') } catch { /* ignore */ }
	}

	async function initE2E() {
		if (!conversation) return
		try {
			// 0. Nouvel appareil ? backup serveur présent mais pas de clé locale →
			//    proposer la restauration AVANT de générer une clé neuve (sinon on
			//    perdrait l'accès à l'historique chiffré).
			if (!restoreDismissed && await shouldOfferRestore(data.token)) {
				showRestore = true
				return
			}

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

			// 6. Bandeau pédagogique : E2E actif mais pas encore de sauvegarde de clé
			//    → on explique et on propose, une seule fois (sauf si déjà ignoré).
			try {
				if (e2eStatus === 'active' || e2eStatus === 'partial') {
					hasBackup = await hasServerBackup(data.token)
					sendGuardAck = localStorage.getItem('nodyx_e2e_send_ack') === '1'
					const dismissed = localStorage.getItem('nodyx_e2e_banner_dismissed') === '1'
					if (!dismissed) showE2eBanner = !hasBackup
				}
			} catch { /* ignore */ }
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
	let dmRootEl: HTMLDivElement | null = $state(null)
	// Hero d'ouverture : overlay éphémère au mount d'une conv pour donner une
	// "ouverture émotionnelle" avant le dump des messages. ~1.2s total.
	let showHero = $state(false)
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

	// Effet -1 : ajuster la hauteur du DM root au viewport disponible.
	// On mesure dynamiquement le top du DM root (= sous le header global
	// Nodyx) et on set height = viewportHeight - top. Comme ça la zone de
	// saisie ne déborde plus, et le header global reste visible. Recalcul
	// au resize de la fenêtre (rotation mobile, redimensionnement).
	$effect(() => {
		const el = dmRootEl
		if (!el || typeof window === 'undefined') return
		function recalc() {
			if (!el) return
			const top = el.getBoundingClientRect().top
			const h   = window.innerHeight - top
			el.style.height    = `${h}px`
			el.style.maxHeight = `${h}px`
		}
		recalc()
		window.addEventListener('resize', recalc)
		// Petite cascade pour absorber les fluctuations layout post-mount
		// (header global qui charge un asset par exemple).
		const t1 = setTimeout(recalc, 100)
		const t2 = setTimeout(recalc, 400)
		return () => {
			window.removeEventListener('resize', recalc)
			clearTimeout(t1); clearTimeout(t2)
		}
	})

	// Effet 0 : inhiber le scroll de la fenêtre (body + html) tant que le DM
	// est monté. Le +layout global a min-h-screen sur sa racine + un <main>
	// avec h-full overflow-y-auto, ce qui crée une deuxième scrollbar de
	// fenêtre quand le DM rentre dans le viewport mais que le main pense
	// avoir une hauteur géante. En bloquant le scroll fenêtre, seul le
	// messagesEl interne scrolle, plus de scrollbars concurrentes.
	$effect(() => {
		if (typeof document === 'undefined') return
		const savedBody = document.body.style.overflow
		const savedHtml = document.documentElement.style.overflow
		document.body.style.overflow = 'hidden'
		document.documentElement.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = savedBody
			document.documentElement.style.overflow = savedHtml
		}
	})

	// Effet 1 : ResizeObserver sur le inner. Capte TOUS les changements de
	// hauteur asynchrones (fonts, images, déchiffrement E2E, nouveaux messages
	// arrivant via socket). Se ré-attache si messagesInnerEl change de réf.
	// DEBUG : trace chaque tentative de re-scroll pour identifier la source.
	let _lastScrollSource = $state('init')
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
				// Démarre une surveillance live de stickBottom dans la console
				// (utile pour confirmer si le state change quand on wheel-up).
				watch: (intervalMs = 500) => {
					console.log('[__dmDebug] watch démarré, stop avec __dmDebug.stopWatch()')
					;(window as any).__dmWatchHandle = setInterval(() => {
						console.log(`stickBottom=${stickBottom} top=${outer.scrollTop} dist=${outer.scrollHeight - outer.scrollTop - outer.clientHeight} lastSrc=${_lastScrollSource}`)
					}, intervalMs)
				},
				stopWatch: () => {
					if ((window as any).__dmWatchHandle) {
						clearInterval((window as any).__dmWatchHandle)
						;(window as any).__dmWatchHandle = null
						console.log('[__dmDebug] watch arrêté')
					}
				},
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
			if (stickBottom) {
				_lastScrollSource = 'resizeObserver'
				outer.scrollTop = outer.scrollHeight
			}
		})
		ro.observe(inner)
		return () => ro.disconnect()
	})

	// Effet Hero : affiche un overlay d'accueil au mount d'une nouvelle conv.
	// 200ms fade-in + scale, 700ms hold, 300ms fade-out = 1.2s total. Skip si
	// pas de conversation (chargement, vue groupée, etc.) — uniquement DM 1:1.
	let _heroShownForConvId = ''
	$effect(() => {
		const cid = conversationId
		if (!cid || cid === _heroShownForConvId) return
		if (!conversation || conversation.is_group) return
		_heroShownForConvId = cid
		showHero = true
		const t = setTimeout(() => { showHero = false }, 1200)
		return () => clearTimeout(t)
	})

	function formatHeroDate(iso: string | undefined): string {
		if (!iso) return ''
		try {
			const d = new Date(iso)
			return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
		} catch { return '' }
	}

	// Effet 2 : scroll initial UNIQUEMENT au changement de conversation.
	// On le distingue du re-render réactif en stockant le dernier convId
	// qu'on a "scroll-initialized". Comme ça les changements de messages
	// (déchiffrement E2E etc.) ne re-déclenchent PAS ce scroll initial.
	let _initializedConvId = ''
	$effect(() => {
		const cid = conversationId
		if (cid === _initializedConvId) return  // déjà initialisé pour ce convId
		_initializedConvId = cid
		stickBottom = true
		if (!messagesEl) return
		const el = messagesEl
		const stick = (source: string) => {
			if (!stickBottom) return
			_lastScrollSource = source
			el.scrollTop = el.scrollHeight
		}
		stick('init:immediate')
		requestAnimationFrame(() => stick('init:rAF'))
		const t1 = setTimeout(() => stick('init:50ms'), 50)
		const t2 = setTimeout(() => stick('init:200ms'), 200)
		const t3 = setTimeout(() => stick('init:400ms'), 400)
		return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
	})
	// (Effet 3 supprimé : redondant avec ResizeObserver, et il pouvait être
	//  une source de re-scroll non désirée. Le ResizeObserver capte déjà
	//  TOUS les changements de hauteur — c'est suffisant.)

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

	// Détection robuste user vs programmatique : on compare le scrollTop
	// précédent au courant. Si ça DIMINUE, c'est l'user qui remonte (peu
	// importe le moyen : wheel, scrollbar, touch, keyboard PageUp). On
	// désactive immédiatement le sticky.
	let lastScrollTop = 0
	function onScroll() {
		if (!messagesEl) return
		const curr = messagesEl.scrollTop
		const wentUp = curr < lastScrollTop - 1   // marge anti-jitter
		lastScrollTop = curr

		if (wentUp) {
			stickBottom = false
		} else {
			// Si l'user revient tout en bas (< 30px du fond), on réactive
			// le sticky pour suivre les nouveaux messages.
			const dist = messagesEl.scrollHeight - curr - messagesEl.clientHeight
			if (dist < 30) stickBottom = true
		}

		if (curr < 80) loadMore()
	}

	// Filets de sécurité : wheel et touch — si pour une raison Svelte/runes
	// le onScroll est en retard sur un re-scroll programmatique, ces handlers
	// désactivent stickBottom AVANT que le scroll natif n'ait lieu.
	function onWheel(e: WheelEvent) {
		if (e.deltaY < 0) stickBottom = false
	}
	function onTouchMove() {
		stickBottom = false
	}

	function emitTyping() {
		const sock = getSocket()
		if (!sock || typingTimeout) return
		sock.emit('dm:typing', conversationId)
		typingTimeout = setTimeout(() => { typingTimeout = null }, 2000)
	}

	// ── Drag & drop image dans la conv ───────────────────────────────────────
	let isDraggingFile = $state(false)
	let uploading = $state(false)

	function onDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types?.includes('Files')) return
		e.preventDefault()
		isDraggingFile = true
	}
	function onDragLeave(e: DragEvent) {
		// Le dragleave se déclenche aussi en entrant sur un enfant : on ne
		// désactive que si on quitte vraiment le conteneur (relatedTarget hors).
		if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
		isDraggingFile = false
	}
	function onDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types?.includes('Files')) return
		e.preventDefault()
		e.dataTransfer.dropEffect = 'copy'
	}
	async function onDrop(e: DragEvent) {
		e.preventDefault()
		isDraggingFile = false
		const file = e.dataTransfer?.files?.[0]
		if (!file) return
		await uploadAndInsert(file)
	}

	async function uploadAndInsert(file: File) {
		if (uploading) return
		if (!file.type.startsWith('image/')) {
			console.warn('[dm:upload] type non supporté:', file.type)
			return
		}
		if (file.size > 8 * 1024 * 1024) {
			console.warn('[dm:upload] fichier trop lourd (>8 Mo)')
			return
		}
		uploading = true
		try {
			const form = new FormData()
			form.append('file', file, file.name)
			const res = await apiFetch(fetch, '/social/upload', {
				method:  'POST',
				body:    form,
				headers: { Authorization: `Bearer ${data.token}` },
			})
			if (!res.ok) {
				console.error('[dm:upload] échec', res.status)
				return
			}
			const { url } = await res.json() as { url: string }
			// Insère l'URL dans la textarea (à la fin si déjà du texte, sinon
			// tout seul). MessageBody la rendra inline comme <img> au envoi.
			messageInput = messageInput.trim()
				? `${messageInput.trim()}\n${url}`
				: url
			tick().then(() => messageTextareaEl?.focus())
		} catch (err) {
			console.error('[dm:upload] error', err)
		} finally {
			uploading = false
		}
	}

	// Reply / quote : message en cours de citation, ou null si rien à citer
	let replyingTo = $state<DmMessage | null>(null)
	function startReply(msg: DmMessage) {
		replyingTo = msg
		// Focus la textarea pour que l'user puisse taper sa réponse immédiatement
		tick().then(() => messageTextareaEl?.focus())
	}
	function cancelReply() { replyingTo = null }
	function replyPreview(msg: DmMessage): string {
		if (msg.is_encrypted) {
			if (msg._decrypted) return msg._decrypted.slice(0, 120)
			return '🔒 message chiffré'
		}
		return (msg.content || '').slice(0, 120)
	}

	async function sendMessage() {
		const content = messageInput.trim()
		if (!content || sendingMsg) return

		// Garde-fou : E2E actif, aucune sauvegarde de clé, pas encore acquitté →
		// on alerte AVANT d'envoyer (perte définitive possible si l'appareil est perdu).
		if ((e2eStatus === 'active' || e2eStatus === 'partial') && !hasBackup && !sendGuardAck) {
			showSendGuard = true
			return
		}

		sendingMsg = true
		messageInput = ''
		// On capture le replyingTo AVANT le clear (pour l'envoyer avec le message)
		const replyId = replyingTo?.id ?? null
		replyingTo = null

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
						reply_to_id: replyId,
					})
				}
			} else {
				// ── Fallback texte clair ────────────────────────────────────────
				if (sock) {
					sock.emit('dm:send', { conversationId, content, reply_to_id: replyId })
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
<!-- height ajusté dynamiquement via $effect : viewport - top du DM root, pour
     que le header global Nodyx reste visible et que la zone de saisie ne
     déborde pas par le bas. -->
<div bind:this={dmRootEl} class="flex bg-gray-950/20 min-h-0 relative"
     ondragenter={onDragEnter}
     ondragover={onDragOver}
     ondragleave={onDragLeave}
     ondrop={onDrop}>

	{#if showRestore}
		<div class="kb-overlay">
			<div class="kb-modal">
				<E2EKeyBackup
					token={data.token}
					mode="restore"
					onDone={() => { showRestore = false; initE2E() }}
					onSkip={() => { restoreDismissed = true; showRestore = false; initE2E() }}
				/>
			</div>
		</div>
	{/if}

	{#if showSendGuard}
		<div class="kb-overlay">
			<div class="kb-modal">
				<div class="sg-head">
					<span class="sg-icon">🛡️</span>
					<div>
						<div class="sg-title">{tFn('dm.guard_title')}</div>
						<div class="sg-text">
							{tFn('dm.guard_text_1')} <strong>{tFn('dm.guard_text_strong')}</strong>. {tFn('dm.guard_text_2')}
						</div>
					</div>
				</div>
				<E2EKeyBackup
					token={data.token}
					mode="manage"
					onDone={() => { hasBackup = true; showSendGuard = false; sendMessage() }}
				/>
				<button class="sg-skip" type="button" onclick={() => {
					sendGuardAck = true
					try { localStorage.setItem('nodyx_e2e_send_ack', '1') } catch { /* ignore */ }
					showSendGuard = false
					sendMessage()
				}}>{tFn('dm.guard_skip')}</button>
			</div>
		</div>
	{/if}

	{#if isDraggingFile}
		<div class="dm-drop-overlay">
			<div class="dm-drop-card">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="dm-drop-icon">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="17 8 12 3 7 8"/>
					<line x1="12" y1="3" x2="12" y2="15"/>
				</svg>
				<div class="dm-drop-title">{tFn('dm.drop_image')}</div>
				<div class="dm-drop-hint">JPG, PNG, WebP, GIF · max 8 Mo</div>
			</div>
		</div>
	{/if}

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
											style={`${i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}; color: ${p.name_color ?? 'var(--nx-accent-soft)'}`}>
											{p.username[0].toUpperCase()}
										</div>
									{/if}
								{/each}
							</div>
						{:else if conv.other_avatar}
							<img src={conv.other_avatar} alt={conv.other_username} class="w-8 h-8 rounded-full object-cover"/>
						{:else}
							<div class="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/15 flex items-center justify-center text-xs font-bold"
								style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: var(--nx-accent-soft)'}>
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
									style={`${i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}; color: ${p.name_color ?? 'var(--nx-accent-soft)'}`}>
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
							style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: var(--nx-accent-soft)'}>
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

					<!-- Réglages du chiffrement (sauvegarde / récupération de clé) -->
					<a href="/settings?section=encryption"
						class="p-1.5 rounded-lg transition-colors hover:bg-white/5 text-gray-400 hover:text-gray-200 shrink-0"
						title={tFn('dm.encryption_settings')}>
						<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
							<circle cx="12" cy="11" r="1.4"/><path d="M12 12.4V14"/>
						</svg>
					</a>

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

		<!-- Hero d'ouverture : overlay éphémère au mount d'une nouvelle conv -->
		{#if showHero && conversation && !conversation.is_group}
			<div class="dm-hero-overlay" aria-hidden="true">
				<div class="dm-hero-card">
					{#if conversation.other_avatar}
						<img src={conversation.other_avatar} alt="" class="dm-hero-avatar" />
					{:else}
						<div class="dm-hero-avatar dm-hero-avatar--initials"
						     style={conversation.other_name_color ? `background: ${conversation.other_name_color}22; color: ${conversation.other_name_color}` : ''}>
							{(conversation.other_username ?? '?')[0].toUpperCase()}
						</div>
					{/if}
					<div class="dm-hero-name"
					     style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : ''}>
						{conversation.other_username}
					</div>
					{#if conversation.created_at}
						<div class="dm-hero-since">
							Vous vous parlez depuis le {formatHeroDate(conversation.created_at)}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if hasBackup && decryptFailed}
		<div class="e2e-banner">
			<div class="e2e-banner-icon">🔑</div>
			<div class="e2e-banner-body">
				<div class="e2e-banner-title">{tFn('dm.restore_banner_title')}</div>
				<div class="e2e-banner-text">
					{tFn('dm.restore_banner_text')}
				</div>
			</div>
			<div class="e2e-banner-actions">
				<button class="e2e-banner-cta" type="button" onclick={() => showRestore = true}>{tFn('dm.restore_key')}</button>
			</div>
		</div>
		{:else if showE2eBanner}
		<div class="e2e-banner">
			<div class="e2e-banner-icon">🛡️</div>
			<div class="e2e-banner-body">
				<div class="e2e-banner-title">{tFn('dm.e2e_banner_title')}</div>
				<div class="e2e-banner-text">
					{tFn('dm.e2e_banner_text_1')} <strong>{tFn('dm.e2e_banner_text_strong')}</strong> {tFn('dm.e2e_banner_text_2')}
				</div>
			</div>
			<div class="e2e-banner-actions">
				<a href="/settings?section=encryption" class="e2e-banner-cta">{tFn('dm.enable_backup')}</a>
				<button class="e2e-banner-dismiss" type="button" onclick={dismissE2eBanner}>{tFn('dm.understood')}</button>
			</div>
		</div>
		{/if}

		<!-- Messages -->
		<div
			bind:this={messagesEl}
			onscroll={onScroll}
			onwheel={onWheel}
			ontouchmove={onTouchMove}
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
											style={msg.sender_name_color ? `color: ${msg.sender_name_color}` : 'color: var(--nx-accent-soft)'}>
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
									<!-- Bouton répondre (visible pour tous, sauf messages systèmes) -->
									<button onclick={() => startReply(msg)}
										class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-indigo-400 transition-colors"
										title={tFn('dm.reply') ?? 'Répondre'}>
										<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<polyline points="9 14 4 9 9 4"/>
											<path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
										</svg>
									</button>
									<!-- Bouton réaction -->
									<button
										onclick={() => pickerOpenMsgId = pickerOpenMsgId === msg.id ? null : msg.id}
										class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-yellow-400 transition-colors"
										title={tFn('dm.react')}>
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
										<button onclick={saveEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">{tFn('dm.enter')}</button>
										<button onclick={cancelEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-gray-400 transition-colors">Échap</button>
									</div>
								{:else}
									<!-- Quote inline si ce message est une réponse à un autre -->
									{#if msg.reply_snapshot}
										<div class="dm-quote">
											<div class="dm-quote-bar"></div>
											<div class="dm-quote-content">
												<div class="dm-quote-author">{msg.reply_snapshot.sender_username}</div>
												<div class="dm-quote-preview">
													{msg.reply_snapshot.is_encrypted ? '🔒 message chiffré' : msg.reply_snapshot.content}
												</div>
											</div>
										</div>
									{/if}
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
							     style="background: var(--nx-accent-strong)">{conversation.participants[0]?.username?.[0]?.toUpperCase() ?? '?'}</div>
						{/if}
					{:else if conversation?.other_avatar}
						<img src={conversation.other_avatar} alt="" class="w-5 h-5 rounded-full object-cover shrink-0 mb-0.5 opacity-70" />
					{:else}
						<div class="w-5 h-5 rounded-full shrink-0 mb-0.5 opacity-70 flex items-center justify-center text-[8px] font-bold text-white"
						     style="background: var(--nx-accent-strong)">{conversation?.other_username?.[0]?.toUpperCase() ?? '?'}</div>
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
			<!-- Banner reply : indique le message qu'on est en train de citer -->
			{#if replyingTo}
				<div class="dm-reply-banner">
					<div class="dm-reply-banner-bar"></div>
					<div class="dm-reply-banner-content">
						<div class="dm-reply-banner-label">{tFn('dm.reply_to')} <strong>{replyingTo.sender_username}</strong></div>
						<div class="dm-reply-banner-preview">{replyPreview(replyingTo)}</div>
					</div>
					<button onclick={cancelReply} class="dm-reply-banner-close" aria-label={tFn('dm.cancel_reply')}>
						<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
							<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
						</svg>
					</button>
				</div>
			{/if}
			<!-- Animation barbare d'envoi -->
			{#if sendingVisual}
				<div class="mb-2 px-3 py-1.5 rounded-xl bg-indigo-900/20 border border-indigo-500/15 text-xs font-mono text-indigo-300/60 truncate tracking-widest animate-pulse">
					{sendingVisual}
				</div>
			{/if}
			<div class="flex items-end gap-3 bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 py-3
						focus-within:border-indigo-500/35 focus-within:bg-indigo-500/[0.04] transition-all duration-200">
				<!-- Mémo audio (signature Nodyx) -->
				<div class="shrink-0">
					<AudioRecorder
						token={data.token}
						onsend={(url) => {
							messageInput = messageInput.trim() ? `${messageInput.trim()}\n${url}` : url
							tick().then(sendMessage)
						}}
					/>
				</div>
				<!-- Bouton emoji picker (Layer 3) — insère à la position du curseur -->
				<div class="relative shrink-0">
					<button
						type="button"
						onclick={(e) => { e.stopPropagation(); composerEmojiOpen = !composerEmojiOpen }}
						class="dm-composer-emoji-btn w-8 h-8 rounded-xl flex items-center justify-center
						       text-gray-500 hover:text-gray-200 hover:bg-white/[0.06]
						       transition-all duration-150"
						title={tFn('common.add_emoji') ?? 'Insérer un emoji'}
						aria-label={tFn('dm.insert_emoji')}
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
/* ── Overlay de restauration de clé E2E (nouvel appareil) ─────────────────── */
.kb-overlay {
	position: absolute;
	inset: 0;
	z-index: 40;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(2, 6, 23, .72);
	backdrop-filter: blur(4px);
	padding: 20px;
}
.kb-modal {
	width: 100%;
	max-width: 460px;
	background: #0f172a;
	border: 1px solid rgba(148, 163, 184, .18);
	border-radius: 16px;
	padding: 22px;
	box-shadow: 0 24px 60px rgba(0, 0, 0, .5);
}

/* ── Bandeau pédagogique E2E ──────────────────────────────────────────────── */
.e2e-banner {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	margin: 10px 20px 0;
	padding: 12px 14px;
	border-radius: 12px;
	background: linear-gradient(135deg, rgba(99,102,241,.12), rgba(168,85,247,.1));
	border: 1px solid rgba(129,140,248,.28);
}
.e2e-banner-icon { font-size: 20px; line-height: 1.2; flex-shrink: 0; }
.e2e-banner-body { flex: 1; min-width: 0; }
.e2e-banner-title { font-size: 13.5px; font-weight: 700; color: #e0e7ff; }
.e2e-banner-text { font-size: 12.5px; color: #c7d2fe; line-height: 1.5; margin-top: 2px; }
.e2e-banner-text strong { color: #fff; }
.e2e-banner-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-self: center; }
.e2e-banner-cta {
	white-space: nowrap; text-align: center; padding: 7px 14px; border-radius: 9px;
	font-size: 12.5px; font-weight: 700; color: #fff; text-decoration: none;
	background: linear-gradient(135deg, var(--nx-accent), var(--nx-accent-2));
}
.e2e-banner-cta:hover { filter: brightness(1.08); }
.e2e-banner-dismiss {
	white-space: nowrap; padding: 5px 14px; border-radius: 9px; cursor: pointer;
	font-size: 12px; font-weight: 600; color: #c7d2fe;
	background: transparent; border: 1px solid rgba(148,163,184,.25);
}

/* ── Modal garde-fou avant envoi ──────────────────────────────────────────── */
.sg-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.sg-icon { font-size: 24px; line-height: 1.1; flex-shrink: 0; }
.sg-title { font-size: 16px; font-weight: 700; color: #fff; }
.sg-text { font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-top: 4px; }
.sg-text strong { color: #fca5a5; }
.sg-skip {
	margin-top: 16px; width: 100%; padding: 9px; border-radius: 10px; cursor: pointer;
	font-size: 13px; font-weight: 500; color: #94a3b8;
	background: transparent; border: 1px solid rgba(148,163,184,.2);
}
.sg-skip:hover { color: #cbd5e1; }

/* ── Drag & drop image overlay ────────────────────────────────────────────── */
.dm-drop-overlay {
	position: absolute;
	inset: 0;
	z-index: 60;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(99, 102, 241, 0.18);
	backdrop-filter: blur(6px);
	-webkit-backdrop-filter: blur(6px);
	pointer-events: none;
	animation: dm-drop-in .15s ease-out;
}
@keyframes dm-drop-in {
	from { opacity: 0; }
	to   { opacity: 1; }
}
.dm-drop-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	padding: 32px 48px;
	background: rgba(15, 15, 22, 0.85);
	border: 2px dashed rgba(124, 58, 237, 0.6);
	border-radius: 14px;
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.dm-drop-icon {
	width: 56px;
	height: 56px;
	color: var(--nx-accent-2-soft2);
}
.dm-drop-title {
	font-size: 18px;
	font-weight: 700;
	color: #f1f5f9;
	font-family: 'Space Grotesk', sans-serif;
}
.dm-drop-hint {
	font-size: 12px;
	color: rgba(226, 232, 240, 0.5);
}

/* ── Reply / quote inline ─────────────────────────────────────────────────── */
.dm-quote {
	display: flex;
	gap: 8px;
	padding: 6px 10px 6px 8px;
	margin-bottom: 4px;
	background: rgba(99, 102, 241, 0.06);
	border-radius: 8px 8px 8px 2px;
	max-width: 100%;
}
.dm-quote-bar {
	width: 3px;
	border-radius: 2px;
	background: linear-gradient(to bottom, var(--nx-accent-soft), var(--nx-accent));
	flex-shrink: 0;
}
.dm-quote-content {
	min-width: 0;
	flex: 1;
}
.dm-quote-author {
	font-size: 11px;
	font-weight: 700;
	color: #a5b4fc;
	margin-bottom: 1px;
}
.dm-quote-preview {
	font-size: 12px;
	color: rgba(226, 232, 240, 0.6);
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	line-clamp: 2;
}

/* ── Banner reply au-dessus du composer ───────────────────────────────────── */
.dm-reply-banner {
	display: flex;
	gap: 10px;
	align-items: center;
	margin-bottom: 8px;
	padding: 8px 10px;
	background: rgba(99, 102, 241, 0.08);
	border: 1px solid rgba(99, 102, 241, 0.18);
	border-radius: 10px;
	animation: dm-reply-banner-in .15s ease-out;
}
@keyframes dm-reply-banner-in {
	from { opacity: 0; transform: translateY(4px); }
	to   { opacity: 1; transform: translateY(0); }
}
.dm-reply-banner-bar {
	width: 3px;
	height: 28px;
	border-radius: 2px;
	background: linear-gradient(to bottom, var(--nx-accent-soft), var(--nx-accent));
	flex-shrink: 0;
}
.dm-reply-banner-content {
	min-width: 0;
	flex: 1;
}
.dm-reply-banner-label {
	font-size: 11px;
	color: #a5b4fc;
	margin-bottom: 2px;
}
.dm-reply-banner-label strong { color: #c7d2fe; font-weight: 700; }
.dm-reply-banner-preview {
	font-size: 12px;
	color: rgba(226, 232, 240, 0.55);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dm-reply-banner-close {
	flex-shrink: 0;
	padding: 4px;
	border-radius: 6px;
	background: transparent;
	border: none;
	color: rgba(165, 180, 252, 0.6);
	cursor: pointer;
	transition: background .15s, color .15s;
}
.dm-reply-banner-close:hover { background: rgba(99, 102, 241, 0.12); color: #c7d2fe; }

/* ── Hero d'ouverture ─────────────────────────────────────────────────────── */
.dm-hero-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 40;
	pointer-events: none;
	background: radial-gradient(circle at center,
		rgba(15, 15, 22, 0.65) 0%,
		rgba(15, 15, 22, 0.0) 70%);
	backdrop-filter: blur(2px);
	-webkit-backdrop-filter: blur(2px);
	animation: dm-hero-overlay 1.2s cubic-bezier(.22,.8,.32,1) forwards;
}
@keyframes dm-hero-overlay {
	0%   { opacity: 0; }
	18%  { opacity: 1; }
	75%  { opacity: 1; }
	100% { opacity: 0; }
}

.dm-hero-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 14px;
	padding: 28px 40px;
	animation: dm-hero-card 1.2s cubic-bezier(.22,.8,.32,1) forwards;
}
@keyframes dm-hero-card {
	0%   { opacity: 0; transform: translateY(8px) scale(0.92); }
	18%  { opacity: 1; transform: translateY(0)   scale(1.02); }
	30%  { transform: translateY(0) scale(1); }
	75%  { opacity: 1; transform: translateY(0) scale(1); }
	100% { opacity: 0; transform: translateY(-6px) scale(1); }
}

.dm-hero-avatar {
	width: 88px;
	height: 88px;
	border-radius: 50%;
	object-fit: cover;
	box-shadow:
		0 0 0 3px rgba(255, 255, 255, 0.06),
		0 0 32px rgba(124, 58, 237, 0.25),
		0 8px 24px rgba(0, 0, 0, 0.4);
}
.dm-hero-avatar--initials {
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(124, 58, 237, 0.12);
	color: var(--nx-accent-2-soft2);
	font-size: 38px;
	font-weight: 800;
	font-family: 'Space Grotesk', sans-serif;
}
.dm-hero-name {
	font-size: 26px;
	font-weight: 700;
	color: #f1f5f9;
	font-family: 'Space Grotesk', sans-serif;
	letter-spacing: -0.01em;
	text-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
}
.dm-hero-since {
	font-size: 12px;
	color: rgba(226, 232, 240, 0.55);
	font-style: italic;
	letter-spacing: 0.02em;
}

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
	40%           { transform: translateY(-5px); background: var(--nx-accent-2-soft); }
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
