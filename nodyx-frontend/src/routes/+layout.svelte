<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { LayoutData } from './$types';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { goto, beforeNavigate } from '$app/navigation';
	import { initSocket, unreadCountStore, chatMentionStore, dmUnreadStore, onlineMembersStore, getSocket } from '$lib/socket';
	import StreamerNotifListener from '$lib/components/streamer/StreamerNotifListener.svelte';
	import { tryAutoConnect } from '$lib/socket';
	import type { UserStatus } from '$lib/socket';
	import { resolveTheme, themeToVars } from '$lib/profileThemes';
	import { buildNameStyle, buildAnimClass, ensureFontLoaded, GOOGLE_FONTS_URL } from '$lib/nameEffects';
	import VoicePanel from '$lib/components/VoicePanel.svelte';
	import StageView from '$lib/components/StageView.svelte';
	import { stageOpenStore } from '$lib/stageStore';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import MatrixRain from '$lib/components/MatrixRain.svelte';
	import MemberScreenPreview from '$lib/components/MemberScreenPreview.svelte';
	import VoiceEqualizer from '$lib/components/VoiceEqualizer.svelte';
	import MaintenanceBanner from '$lib/components/MaintenanceBanner.svelte';
	import { overlayScroll } from '$lib/actions/overlayScroll';
	import { editZone } from '$lib/actions/editZone';
	import EditOverlay from '$lib/components/appearance/EditOverlay.svelte';
	import { shellThemeCss, backdropSource, DEFAULT_SHELL_THEME, type ShellTheme } from '$lib/shellTheme';
	import { shellPreview, identityPreview } from '$lib/shellPreview';
	import NodyxVersionBadge from '$lib/components/NodyxVersionBadge.svelte';
	import FloatingReactions from '$lib/components/FloatingReactions.svelte';
	import ExternalLinkWarning from '$lib/components/ExternalLinkWarning.svelte';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import InstanceRail from '$lib/components/layout/InstanceRail.svelte';
	import ChannelSidebar from '$lib/components/layout/ChannelSidebar.svelte';
	import MemberSidebar from '$lib/components/layout/MemberSidebar.svelte';
	import { get } from 'svelte/store';
	import { voiceStore, voiceChannelMembersStore, voiceEventsStore, screenShareStore, remoteScreenStore } from '$lib/voice';
	import { locale, t, LOCALES, type Locale } from '$lib/i18n';
	import { themePreference } from '$lib/theme';
	import { registerPublicKey } from '$lib/e2e';
	import { shouldOfferRestore } from '$lib/e2eBackupClient';
	import { unreadCountsStore, flashChannelIdStore } from '$lib/unreadStore';
	import { activeCommunityNameStore, panelCollapsedStore, membersCollapsedStore } from '$lib/communityStore';
	import { playMention, playDm } from '$lib/sounds';
	const tFn = $derived($t)

	let { children, data }: { children: any; data: LayoutData } = $props();

	// Pages qui définissent leur PROPRE og:image dans leur <svelte:head>. Sur
	// celles-ci, le layout n'émet pas son og:image par défaut, sinon les scrapers
	// (Discord, Twitter...) reçoivent deux images et en affichent une galerie.
	const PAGES_WITH_OWN_OG = new Set([
		'/forum/[category]/[thread]',
		'/forum/[category]',
		'/users/[username]',
		'/users/[username]/card',
		'/calendar/[id]',
		'/musique',
		'/musique/[slug]',
	]);
	const ownsOgImage = $derived(PAGES_WITH_OWN_OG.has(page.route.id ?? ''));

	const user            = $derived(data.user);
	const isBanned        = $derived(data.user?.is_banned === true);
	// Fond de la sidebar membres : visibilité tout/visiteurs/connectés — pour
	// les connectés la sidebar est fonctionnelle (liste des membres), un fond
	// trop présent la rend illisible ; les visiteurs, eux, n'ont qu'une carte
	// d'invitation, l'image peut y rester pleinement.
	const sidebarBgVisible = $derived.by(() => {
		const bg = data.sidebarBg;
		if (!bg?.background_image_url) return false;
		// Par défaut "visiteurs seulement" : la sidebar est un outil fonctionnel une
		// fois connecté (liste des membres), pas juste une vitrine.
		const vis = bg.visibility ?? 'guests';
		if (vis === 'guests')  return !user;
		if (vis === 'members') return !!user;
		return true;
	});
	const announcement    = $derived((data as any).activeAnnouncement as { id: string; message: string; color: string } | null);
	let announcementDismissed = $state<string | null>(null)
	const showAnnouncement = $derived(
		announcement !== null && announcementDismissed !== announcement?.id
	)
	const unreadCount     = $derived($unreadCountStore);
	const chatMentions    = $derived($chatMentionStore);
	const dmUnread        = $derived($dmUnreadStore);
	const onlineMembers   = $derived($onlineMembersStore);

	// ── Activités en temps réel ────────────────────────────────────────────────
	// Dérivé des stores voice : aucune modif backend requise.
	// Extensible : ajouter streamingUserIds quand le plugin Twitch Rust sera prêt.
	const screenSharingUserIds = $derived((() => {
		const ids = new Set<string>()
		// Partages distants : socketId → userId via peers
		for (const [socketId] of $remoteScreenStore) {
			const peer = $voiceStore.peers.find(p => p.socketId === socketId)
			if (peer) ids.add(peer.userId)
		}
		// Propre partage
		if ($screenShareStore) {
			const uid = (data.user as any)?.id
			if (uid) ids.add(uid)
		}
		return ids
	})())
	// Hook futur plugin Twitch/streaming — à peupler par le plugin Rust
	const streamingUserIds = $derived(new Set<string>())

	// Reset chat mention badge when user is on /chat
	$effect(() => {
		if (page.url.pathname.startsWith('/chat') && $chatMentionStore > 0) {
			chatMentionStore.set(0)
		}
	})

	// Sound — @mention (play once per new mention, not on /chat which handles its own)
	let _lastMentionCount = 0
	$effect(() => {
		const c = $chatMentionStore
		if (c > _lastMentionCount && !page.url.pathname.startsWith('/chat')) {
			playMention()
		}
		_lastMentionCount = c
	})

	// Sound — nouveau DM
	let _lastDmCount = 0
	$effect(() => {
		const c = $dmUnreadStore
		if (c > _lastDmCount) playDm()
		_lastDmCount = c
	})
	const activeCommunityName = $derived($activeCommunityNameStore);
	const communityName      = $derived(data.communityName ?? 'Nodyx');
	const displayCommunityName = $derived(activeCommunityName ?? communityName);
	// Identité : un logo ou une bannière en brouillon (écran Apparence) passe
	// devant la version publiée, pour l'admin seul (SPECS/NODYX_APPARENCE_CDC.md).
	const communityLogo      = $derived(($identityPreview?.logo_url !== undefined ? $identityPreview.logo_url : (data as any).communityLogoUrl) as string | null);
	const communityBanner    = $derived(($identityPreview?.banner_url !== undefined ? $identityPreview.banner_url : (data as any).communityBannerUrl) as string | null);
	// Ambiance (SPECS/NODYX_APPARENCE_CDC.md) : l'aperçu d'un brouillon en cours
	// d'édition passe devant la version publiée, pour l'admin seul.
	// Sans ambiance publiée, l'Originel (le thème de confort par défaut de
	// Nodyx), et non plus l'ancien ambre codé en dur dans app.css.
	const shellTheme      = $derived(($shellPreview ?? (data as any).shellTheme ?? DEFAULT_SHELL_THEME) as ShellTheme);
	// Les anciennes variables de marque des pages ne suivent l'ambiance que si
	// elle est PUBLIÉE (ou en aperçu), jamais sur l'Originel par défaut : une
	// instance à l'ancien thème personnalisé garde son rendu tant qu'elle n'a
	// rien choisi.
	const shellCss        = $derived(shellThemeCss(shellTheme, { legacy: !!($shellPreview ?? (data as any).shellTheme) }));
	const shellBackdrop   = $derived(backdropSource(shellTheme, communityBanner));
	const rawNetworkInstances = $derived((data as any).networkInstances as Array<{
		slug: string; name: string; url: string;
		logo_url: string | null; members: number; online: number; last_seen: string | null;
	}> ?? []);

	const networkInstances = $derived(rawNetworkInstances);
	const activeCommunity = $derived(networkInstances.find(i => i.name === activeCommunityName));
	const activeCommunityUrl = $derived(activeCommunity?.url ? activeCommunity.url.replace(/\/$/, '') : '');

	function instanceOnline(last_seen: string | null): boolean {
		if (!last_seen) return false;
		return Date.now() - new Date(last_seen).getTime() < 5 * 60 * 1000;
	}
	const memberCount     = $derived((data as any).memberCount as number ?? 0);
	const mods            = $derived((data as any).modules as Record<string, boolean> ?? {});

	const isActive = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname.startsWith(href)

	// App-wide theme — cascade : défaut → thème d'INSTANCE (owner, son univers) → thème du MEMBRE (override perso)
	const appVars = $derived(themeToVars(resolveTheme((data as any).appTheme, (data as any).instanceTheme)))
	// Effet de fond posé par l'owner (ex 'matrix' = pluie de caractères derrière le contenu)
	const hasMatrix = $derived((data as any).instanceEffect === 'matrix')

	// ── Mise à jour transparente après un déploiement ───────────────────────────
	// Le service worker signale une nouvelle version (sw:updated / controllerchange).
	// On ne recharge pas brutalement : on attend la PROCHAINE navigation de l'user
	// pour faire un full reload vers sa destination -> il récupère la version fraîche
	// sans jamais avoir à hard-refresh. Plus de "5-6 refresh après une mise à jour".
	// ── Pourquoi un rechargement IMMÉDIAT et non plus « à la prochaine
	//    navigation » (corrigé le 2026-08-15) ────────────────────────────────
	// Le service worker fait `skipWaiting()` + `clients.claim()` : le NOUVEAU
	// service worker prend donc le contrôle d'une page qui exécute encore
	// l'ANCIEN JavaScript. Il lui sert alors les chunks de la nouvelle version,
	// dont les noms hachés ne correspondent plus à ce que ce code attend :
	// l'hydratation Svelte casse et plus AUCUN clic ne répond. La page a l'air
	// normale, elle est morte.
	//
	// Attendre une navigation ne suffit pas : cliquer sur le menu burger n'en
	// est pas une, et l'utilisateur reste bloqué indéfiniment. Symptôme constaté
	// sur téléphone, y compris en « mode ordinateur », alors que tout
	// fonctionnait en navigation privée, c'est-à-dire sans service worker.
	//
	// On recharge donc dès la prise de contrôle. Un rechargement automatique
	// juste après un déploiement est infiniment préférable à une application
	// figée.
	let swUpdateReady = false;
	let swReloading   = false;
	onMount(() => {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

		/** L'utilisateur est-il en train d'écrire ? On ne lui vole pas son texte. */
		function enTrainDEcrire(): boolean {
			const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
			if (!el) return false;
			const editable = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable;
			return editable && !!(el.value?.trim() || el.textContent?.trim());
		}

		function rechargerPourNouvelleVersion() {
			// Garde-fou : `controllerchange` peut se déclencher plus d'une fois,
			// et un rechargement en boucle serait pire que le bug d'origine.
			if (swReloading) return;
			swUpdateReady = true;
			if (enTrainDEcrire()) return;   // le beforeNavigate ci-dessous prendra le relais
			swReloading = true;
			window.location.reload();
		}

		const onMessage = (e: MessageEvent) => {
			if ((e.data as any)?.type === 'sw:updated') rechargerPourNouvelleVersion();
		};
		navigator.serviceWorker.addEventListener('message', onMessage);
		navigator.serviceWorker.addEventListener('controllerchange', rechargerPourNouvelleVersion);
		return () => {
			navigator.serviceWorker.removeEventListener('message', onMessage);
			navigator.serviceWorker.removeEventListener('controllerchange', rechargerPourNouvelleVersion);
		};
	});
	beforeNavigate((nav) => {
		// Navigation interne vers une URL connue : on force un rechargement complet
		// pour basculer sur la nouvelle version (assets + SSR frais).
		if (swUpdateReady && nav.to?.url && nav.type !== 'leave') {
			nav.cancel();
			window.location.href = nav.to.url.href;
		}
	});

	// All community members (for offline section in presence sidebar)
	let allMembers = $state<{ user_id: string; username: string; avatar: string | null }[]>([])

	// Offline = members who are NOT currently in the online list AND are not the current user
	// The logged-in user is always considered online (belt-and-suspenders against race conditions)
	const offlineMembers = $derived(
		allMembers.filter(m =>
			m.user_id !== (user as any)?.id &&
			!onlineMembers.some(o => o.userId === m.user_id)
		)
	)
	let showOffline = $state(false)

	// SSR: set locale from cookie/accept-language BEFORE first render — avoids flash of default 'fr'
	if (data.ssrLocale) locale.setSSR(data.ssrLocale as Locale)
	themePreference.setSSR((data as any).themePref)

	onMount(async () => {
		// Sync/initialize locale on the client side (e.g. read user choice from localStorage)
		locale.init()
		themePreference.init()

		// Register <nodyx-audio-player> custom element (idempotent)
		import('$lib/components/audio/nodyx-audio-player').then(m => m.defineNodyxAudioPlayer())

		if (data.user && data.token && !data.user.is_banned) {
			// SSR provided a valid session — use it directly (skip if banned)
			initSocket(data.token, data.unreadCount ?? 0)

			// Clé de chiffrement DM : enregistrée ici, sur TOUTE page, pas
			// seulement en ouvrant une conversation. Avant ce correctif, la
			// toute première fois que deux personnes qui ne s'étaient jamais
			// écrit s'envoyaient un message, si l'un des deux n'avait encore
			// JAMAIS ouvert ses messages, sa clé n'existait pas encore côté
			// serveur — le premier message partait alors sans chiffrement
			// (repli volontaire, rien ne se perdait, mais ce n'était pas
			// protégé). En l'enregistrant dès la connexion, elle est prête
			// avant même qu'on en ait besoin.
			//
			// Garde IMPORTANTE : sur un appareil neuf avec une sauvegarde
			// existante côté serveur, `registerPublicKey` génèrerait sinon
			// une clé fraîche et l'enregistrerait AVANT que l'utilisateur
			// n'ait vu la proposition de restauration (elle ne vit que sur
			// la page d'une conversation) — l'identité restaurable serait
			// écrasée par une neuve, en silence, dès la première page visitée
			// après une connexion. `shouldOfferRestore` protège exactement
			// contre ça : si un backup existe et qu'aucune clé locale n'est
			// présente, on laisse la main à la page DM, on n'enregistre rien.
			// Ne bloque rien (pas de await sur le tout) : une lenteur ici ne
			// doit jamais retarder l'affichage de la page.
			const e2eToken = data.token
			shouldOfferRestore(e2eToken).then(offerRestore => {
				if (!offerRestore) registerPublicKey(e2eToken)
			})

			// Optimistically add current user to the online store immediately.
			// presence:init will override with server-authoritative data once the
			// socket connects, but this prevents the user from seeing themselves
			// in the offline section during the connection window.
			const uid = (data.user as any).id as string | undefined
			if (uid && !onlineMembers.some(o => o.userId === uid)) {
				onlineMembersStore.update(list => {
					if (list.some(m => m.userId === uid)) return list
					return [...list, {
						userId:            uid,
						username:          data.user!.username,
						avatar:            (data.user as any).avatar ?? null,
						nameColor:         null,
						nameGlow:          null,
						nameGlowIntensity: null,
						nameAnimation:     null,
						nameFontFamily:    null,
						nameFontUrl:       null,
						grade:             null,
						status:            null,
					}]
				})
			}
		} else if (!data.user?.is_banned) {
			// No SSR session (guest page) — try reconnecting from stored token
			tryAutoConnect()
		}

		// Fetch full member list for the offline sidebar section + refresh channels client-side
		if (data.user) {
			try {
				const { PUBLIC_API_URL } = await import('$env/static/public')
				const [membersRes, channelsRes] = await Promise.all([
					fetch(`${PUBLIC_API_URL}/api/v1/instance/members`),
					data.token
						? fetch(`${PUBLIC_API_URL}/api/v1/chat/channels`, {
								headers: { Authorization: `Bearer ${data.token}` }
							})
						: Promise.resolve(null),
				])
				if (membersRes.ok) allMembers = (await membersRes.json()).members ?? []
				if (channelsRes?.ok) {
					const fresh = (await channelsRes.json()).channels ?? []
					if (fresh.length > 0) layoutChannels = fresh
				}
			} catch { /* ignore */ }
		}
	})

	// ── Galaxy Bar mobile drawer ───────────────────────────────────────────────
	let gallerySidebarOpen = $state(false)
	// Ces deux etats viennent du cookie au premier rendu et n'en dependent plus
	// ensuite : c'est une preference locale, elle ne doit PAS se reinitialiser a
	// chaque navigation. Lire la valeur initiale est donc voulu.
	// svelte-ignore state_referenced_locally
	let panelCollapsed = $state(data.panelCollapsed ?? false)
	// svelte-ignore state_referenced_locally
	let membersCollapsed = $state(data.membersCollapsed ?? false)

	function toggleC(velocity: number | MouseEvent = 0) {
		if (typeof velocity === 'number') {
			if (velocity > 500) membersCollapsed = false;
			else if (velocity < -500) membersCollapsed = true;
			else membersCollapsed = !membersCollapsed;
		} else {
			membersCollapsed = !membersCollapsed;
		}
	}

	$effect(() => {
		panelCollapsedStore.set(panelCollapsed);
		if (browser) {
			document.cookie = `nodyx_panel_collapsed=${panelCollapsed}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	$effect(() => {
		membersCollapsedStore.set(membersCollapsed);
		if (browser) {
			document.cookie = `nodyx_members_collapsed=${membersCollapsed}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	// ── Panel resizing logic ──────────────────────────────────────────────────
	// Meme logique que panelCollapsed : largeur initiale lue du cookie, bornee
	// cote serveur dans +layout.server.ts, puis pilotee par le glisser.
	// svelte-ignore state_referenced_locally
	let leftPanelWidth = $state(data.leftPanelWidth ?? 220);
	// svelte-ignore state_referenced_locally
	let rightPanelWidth = $state(data.rightPanelWidth ?? 220);
	let isDraggingLeft = $state(false);
	let isDraggingRight = $state(false);

	$effect(() => {
		if (browser) {
			document.cookie = `nodyx_left_panel_width=${leftPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	$effect(() => {
		if (browser) {
			document.cookie = `nodyx_right_panel_width=${rightPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	// Ferme le drawer sur changement de page (navigation SvelteKit)
	$effect(() => {
		const _ = page.url.pathname
		gallerySidebarOpen = false
	})

	// ── Diagnostic : « écran flouté sans sidebar » ───────────────────────────
	// Symptôme signalé le 2026-08-16, intermittent et jamais reproduit ici : au
	// clic sur le burger, le voile apparaît mais le panneau non. Le voile est
	// désormais monté sous la MÊME condition que le panneau, ce qui rend ce cas
	// impossible par construction. Ce garde-fou reste pour le cas où le panneau
	// serait présent mais invisible pour une AUTRE raison (transform figé,
	// z-index, contexte d'empilement) : il rend alors l'état lisible en console
	// au lieu de laisser l'utilisateur face à un écran flou muet.
	$effect(() => {
		if (!gallerySidebarOpen || typeof document === 'undefined') return
		const t = setTimeout(() => {
			const tous = [...document.querySelectorAll<HTMLElement>('.nodyx-sb .panel')]
			if (tous.length === 0) { console.warn('[nodyx] drawer ouvert, panneau ABSENT du DOM'); return }
			const panneau = tous[tous.length - 1]
			const r = panneau.getBoundingClientRect()
			const st = getComputedStyle(panneau)
			// Hors de l'écran, invisible ou derrière le voile : on le dit.
			if (r.right <= 0 || r.left >= window.innerWidth || st.visibility === 'hidden' || st.display === 'none') {
				console.warn('[nodyx] drawer ouvert mais panneau invisible', {
					x: Math.round(r.x), largeur: Math.round(r.width),
					transform: st.transform, display: st.display,
					visibility: st.visibility, zIndex: st.zIndex,
					// Les trois informations qui manquaient pour trancher :
					// la classe est-elle encore la ? l'etat Svelte dit-il ouvert ?
					// et la media query mobile s'applique-t-elle vraiment ?
					nbPanneaux: tous.length,
					classe: panneau.className,
					etatSvelte: gallerySidebarOpen,
					largeurEcran: window.innerWidth,
					mobileActif: window.matchMedia('(max-width: 1023px)').matches,
					styleInline: panneau.getAttribute('style'),
				})
			}
		}, 400)   // après la transition d'ouverture
		return () => clearTimeout(t)
	})

	// Bloque le scroll du body quand le drawer est ouvert
	$effect(() => {
		if (!browser) return
		if (gallerySidebarOpen) {
			document.body.classList.add('no-scroll')
		} else {
			document.body.classList.remove('no-scroll')
		}
		return () => document.body.classList.remove('no-scroll')
	})

	// ── User dropdown ──────────────────────────────────────────────────────────
	// dropdownOpen a demenage dans Header.svelte (etat purement local au menu).
	let langView = $state(false)
	let langSaved = $state(false)
	let langSavedTimeout: ReturnType<typeof setTimeout> | undefined
	// Close the language pane when the route changes — otherwise it stays
	// mounted over the new page until the user clicks "back".
	let skipLangReset = false
	$effect(() => {
		page.url.pathname
		if (skipLangReset) { skipLangReset = false; return }
		langView = false
	})
	function openLang() {
		skipLangReset = true
		langView = true
		goto('/', { noScroll: true })
	}
	const currentLocale = $derived($locale)
	function pickLocale(code: Locale) {
		locale.setLocale(code)
		langSaved = true
		clearTimeout(langSavedTimeout)
		langSavedTimeout = setTimeout(() => langSaved = false, 2000)
	}

	// Swipe-to-dismiss for mobile — F12: spring-feel transition via CSS
	let touchStartY = 0
	let touchCurrentY = 0
	let langDragY = $state(0)
	function onLangTouchStart(e: TouchEvent) { touchStartY = e.touches[0].clientY }
	function onLangTouchMove(e: TouchEvent) {
		touchCurrentY = e.touches[0].clientY
		const diff = touchCurrentY - touchStartY
		if (diff > 0) langDragY = diff
	}
	function onLangTouchEnd() {
		const diff = touchCurrentY - touchStartY
		if (diff > 100) {
			langView = false
		}
		langDragY = 0
	}

	// XP info — formule sqrt identique à ProfileCard / MiniProfileCard / page profil
	const xpInfo = $derived((() => {
		const pts   = user?.points ?? 0
		const level = Math.floor(Math.sqrt(Math.max(0, pts) / 10)) + 1
		const from  = (level - 1) * (level - 1) * 10
		const to    = level * level * 10
		const pct   = Math.min(100, Math.round(((pts - from) / (to - from)) * 100))
		return { pts, from, to, pct, level }
	})())

	function gradeTextColor(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
		return luminance > 0.5 ? '#111827' : '#ffffff'
	}

	// ── Channel Sidebar ────────────────────────────────────────────────────────
	type LayoutChannel = {
		id:              string
		name:            string
		type?:           string
		name_color?:     string | null
		name_bold?:      boolean
		name_italic?:    boolean
		name_underline?: boolean
		icon_emoji?:     string | null
	}
	let layoutChannels = $state<LayoutChannel[]>((data as any).channels ?? [])

	const layoutTextChannels = $derived(layoutChannels.filter(c => !c.type || c.type === 'text'))
	const layoutVoiceChannels = $derived(layoutChannels.filter(c => c.type === 'voice'))

	function chNameStyle(ch: LayoutChannel, override: string | null = null): string {
		const parts: string[] = []
		const color = ch.name_color ?? override
		if (color)             parts.push(`color: ${color}`)
		if (ch.name_bold)      parts.push('font-weight: 700')
		if (ch.name_italic)    parts.push('font-style: italic')
		if (ch.name_underline) parts.push('text-decoration: underline')
		return parts.join(';')
	}
	const showChannelSidebar = $derived(
		!isBanned &&
		!page.url.pathname.startsWith('/admin') &&
		!page.url.pathname.startsWith('/auth') &&
		page.url.pathname !== '/banned'
	)
	// Géométrie du contenant flottant (app.css, « Contenant flottant ») : bord
	// gauche du contenu = marge + rail + marge (+ panneau + marge s'il est
	// ouvert). Même condition que `panel-collapsed` sur <main>, calculée une
	// seule fois ici pour le header, <main> et les pages en `fixed` (chat).
	const leftPanelOpen = $derived(!(isBanned || !showChannelSidebar || panelCollapsed))
	const shellVars = $derived(
		`--shell-left: calc(var(--shell-gap) * 2 + var(--shell-rail-w)${leftPanelOpen ? ` + ${leftPanelWidth}px + var(--shell-gap)` : ''});` +
		`--shell-members: ${membersCollapsed ? '0px' : `calc(${rightPanelWidth}px + var(--shell-gap))`}`
	)

	// Routes /overlay/* sont des pages OBS browser source : fullscreen
	// transparent, AUCUN chrome Nodyx (ni nav, ni sidebar, ni members bar).
	// Routes /deck/* sont des pages mobile-first tactiles (Nodyx Deck) : même
	// principe, on veut tout l'écran pour la grille de boutons.
	// /translate est une page publique autonome (translate.nodyx.org) : elle
	// porte sa propre barre d'application, le chrome de l'app ferait doublon.
	// On bypass complètement le rendu du layout pour ces routes.
	const isBareRoute = $derived(
		page.url.pathname.startsWith('/overlay/') ||
		page.url.pathname.startsWith('/deck/') ||
		page.url.pathname === '/translate',
	)

	// Active channel ID from URL (used on /chat to highlight the current channel)
	const activeChatChannelId = $derived(page.url.searchParams.get('channel') ?? null)

	// ── Voice state (for member roster in sidebar) ─────────────────────────────
	const voiceState       = $derived($voiceStore)
	const vcMembers        = $derived($voiceChannelMembersStore)
	const voiceToasts      = $derived($voiceEventsStore)

	// ── Member groups by grade ─────────────────────────────────────────────────
	const memberGroups = $derived((() => {
		const groups = new Map<string, typeof onlineMembers>()
		const ungrouped: typeof onlineMembers = []
		for (const m of onlineMembers) {
			if (m.grade) {
				if (!groups.has(m.grade.name)) groups.set(m.grade.name, [])
				groups.get(m.grade.name)!.push(m)
			} else {
				ungrouped.push(m)
			}
		}
		return { groups, ungrouped }
	})())


	// ── Screen preview hover popup ────────────────────────────────────────────
	let screenPreview = $state<{ stream: MediaStream; username: string; avatar: string | null; x: number; y: number; side: 'left' | 'right' } | null>(null)

	// Use get() to read store values from within event handlers (not reactive context)
	function getScreenStream(userId: string): MediaStream | null {
		const peers  = get(voiceStore).peers
		const screens = get(remoteScreenStore)
		const peer = peers.find((p: any) => p.userId === userId)
		if (!peer) return null
		return screens.get(peer.socketId) ?? null
	}

	function showScreenPreview(e: MouseEvent, userId: string | null, username: string, avatar: string | null, side: 'left' | 'right') {
		if (!userId) return
		const stream = getScreenStream(userId)
		if (!stream) return
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const x = side === 'right' ? rect.right : rect.left
		screenPreview = { stream, username, avatar, x, y: rect.top, side }
	}

	// ── Custom status ─────────────────────────────────────────────────────────
	let showStatusModal = $state(false)
	let statusEmoji     = $state('')
	let statusText      = $state('')

	const PRESET_STATUSES = $derived([
		{ emoji: '💼', text: tFn('status.working') },
		{ emoji: '🎮', text: tFn('status.gaming') },
		{ emoji: '🎵', text: tFn('status.listening') },
		{ emoji: '📚', text: tFn('status.reading') },
		{ emoji: '🍕', text: tFn('status.lunch') },
		{ emoji: '🤔', text: tFn('status.thinking') },
		{ emoji: '😴', text: tFn('status.dnd') },
		{ emoji: '🏃', text: tFn('status.back_later') },
	])

	// Load custom fonts for online members whenever the list changes
	$effect(() => {
		for (const m of onlineMembers) {
			ensureFontLoaded(m.nameFontFamily ?? null, m.nameFontUrl ?? null)
		}
	})

	// Find logged-in user's current status from the store
	const myStatus = $derived(onlineMembers.find(m => m.userId === (user as any)?.id)?.status ?? null)

	function openStatusModal() {
		statusEmoji = myStatus?.emoji ?? ''
		statusText  = myStatus?.text ?? ''
		showStatusModal = true
	}

	async function saveStatus() {
		const payload = (statusEmoji || statusText)
			? { emoji: statusEmoji.trim(), text: statusText.trim() }
			: null
		showStatusModal = false

		// Optimistic local update — UI reflects the change immediately
		const uid = (user as any)?.id as string | undefined
		if (uid) {
			onlineMembersStore.update(list =>
				list.map(m => m.userId === uid ? { ...m, status: payload } : m)
			)
		}

		try {
			await fetch('/api/v1/instance/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
				body: JSON.stringify(payload ?? {}),
			})
		} catch { /* ignore network errors */ }
	}

	async function clearStatus() {
		showStatusModal = false
		const uid = (user as any)?.id as string | undefined
		if (uid) {
			onlineMembersStore.update(list =>
				list.map(m => m.userId === uid ? { ...m, status: null } : m)
			)
		}
		try {
			await fetch('/api/v1/instance/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
				body: JSON.stringify({}),
			})
		} catch { /* ignore */ }
	}

	// ── Contextual breadcrumb ──────────────────────────────────────────────────
	const breadcrumbs = $derived((() => {
		const path = page.url.pathname;
		const d = page.data as any;
		if (path === '/') return [];
		const crumbs: { label: string; href?: string }[] = [];
		if (path.startsWith('/forum')) {
			crumbs.push({ label: tFn('nav.forum'), href: '/forum' });
			if (d?.category?.name) {
				const name = (d.category.name as string).replace(/^\p{Emoji}\s*/u, '');
				crumbs.push({ label: name, href: `/forum/${d.category.slug ?? d.category.id}` });
			}
			if (d?.thread?.title) crumbs.push({ label: d.thread.title });
		} else if (path.startsWith('/chat')) {
			crumbs.push({ label: tFn('nav.chat') });
			const chId = page.url.searchParams.get('channel');
			if (chId) {
				const ch = layoutChannels.find(c => c.id === chId);
				if (ch) crumbs.push({ label: (ch.type === 'voice' ? '🔊 ' : '# ') + ch.name });
			}
		} else if (path.startsWith('/dm'))           { crumbs.push({ label: tFn('nav.dm') });
		} else if (path.startsWith('/calendar'))     { crumbs.push({ label: tFn('nav.calendar') });
		} else if (path.startsWith('/discover'))     { crumbs.push({ label: tFn('nav.discover') });
		} else if (path.startsWith('/admin'))        { crumbs.push({ label: tFn('nav.admin') });
		} else if (path.startsWith('/notifications')){ crumbs.push({ label: tFn('nav.notifications') });
		} else if (path.startsWith('/settings'))     { crumbs.push({ label: tFn('nav.settings') });
		} else if (path.startsWith('/users/me/edit')){ crumbs.push({ label: tFn('nav.edit_profile') });
		} else if (path.startsWith('/users/'))       { crumbs.push({ label: path.split('/')[2] ?? tFn('nav.profile') });
		} else if (path.startsWith('/communities'))  { crumbs.push({ label: tFn('nav.communities') });
		} else if (path.startsWith('/polls'))        { crumbs.push({ label: tFn('nav.polls') });
		} else if (path.startsWith('/tasks'))        { crumbs.push({ label: tFn('nav.tasks') });
		} else if (path.startsWith('/wiki'))         { crumbs.push({ label: tFn('nav.wiki') });
		} else if (path.startsWith('/library'))      { crumbs.push({ label: tFn('nav.library') });
		} else if (path.startsWith('/musique'))      { crumbs.push({ label: tFn('nav.music') });
		} else if (path.startsWith('/search'))       { crumbs.push({ label: tFn('nav.search') });
		} else if (path.startsWith('/garden'))       { crumbs.push({ label: tFn('nav.garden') });
		} else {
			const seg = path.split('/')[1];
			if (seg) crumbs.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1) });
		}
		return crumbs;
	})())

	// ── Header search ──────────────────────────────────────────────────────────
	let searchQ      = $state('');
	let searchFocused = $state(false);
	function doSearch(e: Event) {
		e.preventDefault();
		if (searchQ.trim()) { goto(`/search?q=${encodeURIComponent(searchQ.trim())}`); searchQ = ''; }
	}

	// ── Command Palette ────────────────────────────────────────────────────────
	let paletteOpen = $state(false)

	function handleGlobalKeydown(e: KeyboardEvent) {
		// Ctrl+K or Cmd+K — open palette
		if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			e.preventDefault()
			paletteOpen = true
			return
		}
		// Escape closes language pane
		if (e.key === 'Escape' && langView) {
			e.preventDefault()
			langView = false
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
	<!-- The favicon is intentionally not overridden by the community logo
	     anymore. It stays the Nodyx brand mark declared in app.html (and
	     a self-hoster can replace static/favicon.ico if they want their
	     own). Decoupling favicon (brand identity) from communityLogo
	     (community identity) prevents an uploaded square logo from being
	     stretched into a 16×16 tab icon. -->
	<meta property="og:site_name" content={communityName} />
	<!-- og:image en URL ABSOLUE : Discord/Twitter/Facebook ne résolvent pas
	     les chemins relatifs (l'ancien /og-image.jpg de app.html ne
	     s'affichait jamais dans les partages). Les pages qui définissent
	     leur propre og:image (threads) ajoutent la leur en plus. -->
	{#if !ownsOgImage}
		<meta property="og:image" content="{page.url.origin}/og-image.jpg" />
		<meta property="og:image:width"  content="1200" />
		<meta property="og:image:height" content="630" />
		<meta name="twitter:image" content="{page.url.origin}/og-image.jpg" />
	{/if}
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="theme-color" content="var(--nx-accent)" />
	<!-- Preload all Google Font presets (avatar/username effects) -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href={GOOGLE_FONTS_URL} />
	<!-- Thème d'instance : surcharge des variables CSS, posé par l'owner (instance_settings.theme_css).
	     On retire tout '<' pour empêcher un breakout </style>. -->
	<!-- Ambiance de l'instance : variables --nx-* DÉRIVÉES de réglages validés
	     (couleurs calculées, nombres), jamais une chaîne fournie telle quelle. -->
	{#if shellCss}
		{@html `<style id="nx-shell-theme">${shellCss.replace(/</g, '')}</style>`}
	{/if}
	{#if data.themeCss}
		{@html `<style id="instance-theme">${data.themeCss.replace(/</g, '')}</style>`}
	{/if}
</svelte:head>

{#if isBareRoute}
	<!-- Page autonome (overlay OBS, deck, /translate) : aucun chrome Nodyx. -->
	{@render children()}
{:else}
{#if hasMatrix}<MatrixRain />{/if}
<div class="nx-shell min-h-dvh flex flex-col" class:has-wallpaper={!!shellBackdrop && !hasMatrix}
     style="{appVars}; {shellVars}; --shell-bg: {hasMatrix ? 'transparent' : 'var(--p-bg)'}; color: var(--p-text)">

	{#if shellBackdrop && !hasMatrix}
		<!-- Papier peint du contenant flottant : le décor choisi dans l'ambiance
		     (la bannière par défaut), flouté (app.css, .nx-wallpaper).
		     Décoratif, masqué sous 1024px. -->
		<div class="nx-wallpaper" aria-hidden="true">
			<img src={shellBackdrop} alt="" decoding="async" fetchpriority="low" />
		</div>
	{/if}

	<!-- Listener Streamer Hub : joue les sons de notif pour les admins/owners. -->
	{#if data.user?.role}
		<StreamerNotifListener role={data.user.role} />
	{/if}

	<!-- Mode « au stylo » : barre, panneaux, Échap (inerte hors mode édition). -->
	{#if user?.role === 'owner' || user?.role === 'admin'}<EditOverlay />{/if}

	<!-- ══ MAINTENANCE BANNER (sticky top, hidden when no op in progress) ════════ -->
	<MaintenanceBanner />

	<!-- ══ CONTEXT BAR ══════════════════════════════════════════════════════== -->
	<Header
		{isBanned}
		{showChannelSidebar}
		bind:gallerySidebarOpen
		bind:panelCollapsed
		{leftPanelWidth}
		isDraggingLeftPanel={isDraggingLeft}
		{communityName}
		{breadcrumbs}
		{currentLocale}
		{membersCollapsed}
		{user}
		{unreadCount}
		{dmUnread}
		{myStatus}
		onOpenPalette={() => paletteOpen = true}
		onOpenLang={openLang}
		onToggleMembers={toggleC}
		onOpenStatusModal={openStatusModal}
	/>

	<!-- ══ BODY ═══════════════════════════════════════════════════════════════ -->
	<div class="flex flex-1 min-h-0"
	     style="--left-panel-width: {leftPanelWidth}px; --right-panel-width: {rightPanelWidth}px;"
	     class:layout-dragging={isDraggingLeft || isDraggingRight}>

		<!-- ── Backdrop Channel Sidebar — mobile ──────────────────────────────── -->
		<!-- Le voile est monte sous la MEME condition que le panneau, `showChannelSidebar`
		     comprise. Avant, le voile ne dependait que de `gallerySidebarOpen` et le
		     panneau aussi de `showChannelSidebar` : des que la seconde devenait fausse
		     (routes /admin, /auth, /banned), on obtenait un ECRAN FLOUTE SANS SIDEBAR,
		     exactement le symptome signale le 16/08. Les lier rend ce cas impossible,
		     quelle que soit la sequence qui y menait. -->
		{#if !isBanned && showChannelSidebar && gallerySidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="lg:hidden fixed inset-0 bg-black/60 z-[54] backdrop-blur-xs"
		     role="button" tabindex="-1" aria-label={tFn('common.close_menu')}
		     onclick={() => gallerySidebarOpen = false}
		     onkeydown={e => e.key === 'Escape' && (gallerySidebarOpen = false)}
		     transition:fade={{ duration: 200 }}></div>
		{/if}

		<InstanceRail
			{isBanned}
			{communityName}
			{communityLogo}
			bind:panelCollapsed
			{networkInstances}
		/>

		<ChannelSidebar
			{isBanned}
			{showChannelSidebar}
			bind:gallerySidebarOpen
			bind:panelCollapsed
			bind:leftPanelWidth
			bind:isDraggingLeft
			{communityName}
			{user}
			{mods}
			{activeCommunityUrl}
			{layoutTextChannels}
			{layoutVoiceChannels}
			{screenSharingUserIds}
			onShowScreenPreview={showScreenPreview}
			onHideScreenPreview={() => { screenPreview = null }}
			onOpenStatusModal={openStatusModal}
		/>



		<!-- ── Contenu principal ───────────────────────────────────────────────── -->
		<div class="relative flex-1 overflow-hidden">
		<!-- app-shell-main : marqueur pour scoper les décalages (padding-left rail+sidebar,
		     margin-right membres) à CE main uniquement. Sans ça, `:global(main.app-shell-main)` frappait
		     AUSSI les <main> imbriqués des pages (profil, settings, admin, dm) et leur
		     collait un padding-left 276px + margin-right 220px parasites → contenu poussé
		     au milieu et rétréci. -->
		<!-- overflow-x-hidden : zone de contenu d'appli = défilement vertical seul.
		     `overflow-y-auto` force sinon overflow-x à `auto` (spec CSS), et le
		     moindre debordement (ex: banniere full-bleed -mx-6 du profil, +24px)
		     faisait apparaitre une scrollbar horizontale + du contenu glissant
		     sous les sidebars. On clippe l'horizontal, plus jamais de scrollbar. -->
		<main data-nx-zone="sheet" use:overlayScroll use:editZone={{ zone: page.url.pathname === '/' ? 'home' : 'sheet', label: page.url.pathname === '/' ? tFn('edit.zone_home') : tFn('edit.zone_sheet') }} class="app-shell-main {langView ? 'h-[calc(100dvh-48px)] overflow-hidden' : 'h-full overflow-y-auto overflow-x-hidden'} min-w-0 pb-[var(--bottom-nav-h)]"
		      class:panel-collapsed={isBanned || !showChannelSidebar || panelCollapsed}
		      class:members-collapsed={membersCollapsed}>

            <!-- ── System announcement banner ─────────────────────────────────── -->
            {#if showAnnouncement && announcement}
                {@const colorClass = {
                    indigo: 'bg-indigo-950/90 border-indigo-700/60 text-indigo-100',
                    amber:  'bg-amber-950/90  border-amber-700/60  text-amber-100',
                    green:  'bg-green-950/90  border-green-700/60  text-green-100',
                    red:    'bg-red-950/90    border-red-700/60    text-red-100',
                    sky:    'bg-sky-950/90    border-sky-700/60    text-sky-100',
                    rose:   'bg-rose-950/90   border-rose-700/60   text-rose-100',
                }[announcement.color] ?? 'bg-indigo-950/90 border-indigo-700/60 text-indigo-100'}
                <div class="border-b px-4 py-2.5 flex items-center gap-3 text-sm {colorClass}">
                    <svg class="w-4 h-4 shrink-0 opacity-80" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
                    </svg>
                    <span class="flex-1 font-medium">{announcement.message}</span>
                    <button
                        onclick={() => announcementDismissed = announcement!.id}
                        class="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-2"
                        aria-label={tFn('announcement.dismiss')}
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            {/if}


            <div class="w-full flex-1 flex flex-col {langView ? 'lang-view-wrap h-full' : (page.url.pathname === '/' || page.url.pathname.startsWith('/chat') || page.url.pathname.startsWith('/admin') || page.url.pathname.startsWith('/users/') || page.url.pathname.startsWith('/feed') || page.url.pathname.startsWith('/settings') || page.url.pathname.startsWith('/garden') || page.url.pathname.startsWith('/calendar') || page.url.pathname.startsWith('/discover') || page.url.pathname.startsWith('/wiki') || page.url.pathname.startsWith('/library') || page.url.pathname.startsWith('/musique') || page.url.pathname.startsWith('/dm') || page.url.pathname.startsWith('/auth/') ? 'h-full' : (page.url.pathname.startsWith('/forum') || page.url.pathname.startsWith('/tasks')) ? 'px-4 sm:px-6 py-8' : 'max-w-5xl mx-auto px-4 py-8')}">
                {#if langView}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="fixed inset-0 bg-black/40 backdrop-blur-xs z-40" onclick={() => langView = false} transition:fade={{ duration: 200 }}></div>
                    <div
                        class="lang-view flex flex-col gap-4 w-full h-full min-h-0 p-6 sm:p-8 relative z-41"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="lang-title"
                        aria-describedby="lang-desc"
                        style="transform: translateY({langDragY}px); transition: transform {langDragY > 0 ? 'none' : '0.3s cubic-bezier(0.16, 1, 0.3, 1)'};"
                        transition:fly={{ y: 20, duration: 300, easing: cubicOut }}
                        ontouchstart={onLangTouchStart}
                        ontouchmove={onLangTouchMove}
                        ontouchend={onLangTouchEnd}
                    >
                        <button onclick={() => langView = false} class="lang-back inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 shrink-0 bg-transparent border border-white/[0.12] rounded-md px-3 py-2 cursor-pointer" aria-label={tFn('common.back')}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 12H5M12 5l-7 7 7 7"/>
                            </svg>
                            {tFn('common.back')}
                        </button>
                        <div class="flex flex-col gap-4 min-h-0 flex-1">
                            <div class="flex items-start gap-4 mb-1 shrink-0">
                                <div class="lang-icon w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
                                    </svg>
                                </div>
                                <div>
                                    <h2 id="lang-title" class="lang-title text-xl font-bold text-slate-100 m-0 mb-1 leading-tight">{tFn('settings.language.title')}</h2>
                                    <p id="lang-desc" class="text-[13px] text-gray-500 leading-relaxed m-0">{tFn('settings.language.desc')}</p>
                                </div>
                            </div>
                            <div class="lang-card rounded-lg p-5 min-h-0 flex flex-col flex-1">
                                <div class="lang-segments flex flex-col gap-2 overflow-y-auto overflow-x-hidden flex-1 min-h-0 px-2">
                                    {#each LOCALES as loc}
                                    <button
                                        onclick={() => pickLocale(loc.code)}
                                        class="lang-seg flex items-center gap-4 p-4 rounded-lg border border-white/[0.06] bg-white/[0.02] cursor-pointer w-full relative overflow-hidden shrink-0 text-left {currentLocale === loc.code ? 'active' : ''}"
                                    >
                                        <span class="shrink-0 flex items-center leading-none"><ChannelIcon value={loc.flagIcon} size={26} /></span>
                                        <span class="flex-1 min-w-0">
                                            <span class="lang-label text-sm font-semibold text-slate-200 block leading-relaxed">{loc.label}</span>
                                        </span>
                                        {#if currentLocale === loc.code}
                                        <svg class="lang-seg-check w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                                        </svg>
                                        {/if}
                                    </button>
                                    {/each}
                                </div>
                            </div>
                            {#if langSaved}
                            <div class="lang-success mt-3 py-2 px-3 rounded-md text-[13px] font-medium shrink-0 bg-green-400/10 border border-green-400/20 text-green-400">{tFn('settings.language.saved')}</div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    {@render children()}
                {/if}
            </div>
        </main>
		</div>

		<MemberSidebar
			bind:membersCollapsed
			bind:isDraggingRight
			bind:rightPanelWidth
			sidebarBg={data.sidebarBg}
			{user}
			{onlineMembers}
			{memberGroups}
			{offlineMembers}
			{memberCount}
			{screenSharingUserIds}
			{streamingUserIds}
			nodyxVersion={data.nodyxVersion ?? 'unknown'}
			onShowScreenPreview={showScreenPreview}
			onHideScreenPreview={() => { screenPreview = null }}
			onOpenStatusModal={openStatusModal}
			onToggleMembers={toggleC}
		/>

	</div>

	<!-- ══ BOTTOM NAV mobile (lg:hidden) — hidden for banned users ═════════ -->
	{#if !isBanned}
	<!-- Fond OPAQUE, et surtout pas `--p-card-bg`. Celui-ci est un fond de CARTE :
	     six thèmes sur sept sont translucides par construction, dont un à 5%
	     d'opacité. Une carte translucide posée sur un fond de page est voulue,
	     une barre FIXE avec du contenu qui défile dessous devient du verre. Le
	     2026-08-15, on lisait « Dernier message » et « Pokled » au travers, par
	     dessus les icônes. `--p-bg` est opaque sur les sept thèmes.
	     Gardé par tests/responsive/bottom-nav.spec.ts. -->
	<nav class="lg:hidden fixed bottom-0 left-0 right-0 z-45 border-t border-gray-800 flex items-stretch"
	     style="background: var(--p-bg); border-color: var(--p-card-border); padding-bottom: env(safe-area-inset-bottom, 0px)">

		<!-- Fil d'actu (si connecté) -->
		{#if user}
		<a href="/feed" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/feed') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M3 6h18M3 18h12"/>
			</svg>
			<span class="text-xs font-medium">{tFn('nav.bar_feed')}</span>
		</a>
		{/if}

		<!-- Forum -->
		<a href="/forum" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/forum') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
				<polyline stroke-linecap="round" stroke-linejoin="round" points="9 22 9 12 15 12 15 22"/>
			</svg>
			<span class="text-xs font-medium">{tFn('nav.bar_forum')}</span>
		</a>

		<!-- Chat (si connecté) -->
		{#if user}
		<a href="/chat" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 relative {isActive('/chat') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			{#if unreadCount > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{unreadCount > 9 ? '9+' : unreadCount}
				</span>
			{/if}
			<span class="text-xs font-medium">{tFn('nav.bar_chat')}</span>
		</a>
		{/if}

		<!-- Messages privés (si connecté) -->
		{#if user}
		<a href="/dm" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 relative {isActive('/dm') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
			</svg>
			{#if dmUnread > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{dmUnread > 9 ? '9+' : dmUnread}
				</span>
			{/if}
			<span class="text-xs font-medium">{tFn('nav.bar_dm')}</span>
		</a>
		{/if}

		<!-- Bibliothèque -->
		<a href="/library" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/library') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
			</svg>
			<span class="text-xs font-medium">{tFn('nav.bar_library')}</span>
		</a>

		<!-- Annuaire -->
		<a href="/communities" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/communities') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="10"/>
				<line x1="2" y1="12" x2="22" y2="12"/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
			</svg>
			<span class="text-xs font-medium">{tFn('nav.bar_directory')}</span>
		</a>

		<!-- Profil / Connexion -->
		{#if user}
		<a href="/users/{user.username}"
		   class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {page.url.pathname.startsWith('/users/') ? 'text-indigo-400' : 'text-gray-500'}">
			{#if user.avatar}
				<img src={user.avatar} class="w-5 h-5 rounded-full object-cover" alt="" />
			{:else}
				<div class="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-[9px] font-bold text-white">
					{user.username.charAt(0).toUpperCase()}
				</div>
			{/if}
			<span class="text-xs font-medium">{tFn('nav.bar_profile')}</span>
		</a>
		{:else}
		<a href="/auth/login" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 text-gray-500">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
				<polyline stroke-linecap="round" stroke-linejoin="round" points="10 17 15 12 10 7"/>
				<line x1="15" y1="12" x2="3" y2="12"/>
			</svg>
			<span class="text-xs font-medium">{tFn("common.login")}</span>
		</a>
		{/if}
	</nav>
	{/if}
</div>
{/if}<!-- /isBareRoute -->

<!-- ── Status modal ──────────────────────────────────────────────────────── -->
{#if showStatusModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) showStatusModal = false }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5"
			onclick={(e) => e.stopPropagation()}>
			<h2 class="text-sm font-bold text-white mb-4">{tFn('status.modal_title')}</h2>

			<!-- Current status preview -->
			<div class="flex items-center gap-2.5 mb-4 px-3 py-2 bg-gray-800 rounded-xl border border-gray-700">
				<span class="text-xl w-8 text-center">{statusEmoji || '😶'}</span>
				<span class="text-sm text-gray-300 flex-1 truncate">{statusText || tFn('status.none')}</span>
			</div>

			<!-- Emoji + text inputs -->
			<div class="flex gap-2 mb-3">
				<input
					type="text"
					placeholder="😀"
					bind:value={statusEmoji}
					maxlength={8}
					class="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-center text-lg outline-hidden focus:border-indigo-600 transition-colors"
				/>
				<input
					type="text"
					placeholder={tFn('status.placeholder')}
					bind:value={statusText}
					maxlength={60}
					class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-hidden focus:border-indigo-600 transition-colors"
				/>
			</div>

			<!-- Preset statuses -->
			<div class="grid grid-cols-2 gap-1.5 mb-4">
				{#each PRESET_STATUSES as preset}
					<button
						onclick={() => { statusEmoji = preset.emoji; statusText = preset.text }}
						class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors border {statusEmoji === preset.emoji && statusText === preset.text ? 'border-indigo-500 bg-indigo-500/20 text-white' : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600 hover:text-white'}"
					>
						<span>{preset.emoji}</span>
						<span class="truncate">{preset.text}</span>
					</button>
				{/each}
			</div>

			<div class="flex gap-2">
				{#if myStatus}
					<button onclick={clearStatus} class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors">
						{tFn('common.clear')}
					</button>
				{/if}
				<button onclick={() => showStatusModal = false} class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors ml-auto">
					{tFn('common.cancel')}
				</button>
				<button onclick={saveStatus} class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium transition-colors">
					{tFn('common.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Voice toasts ─────────────────────────────────────────────────────────── -->
{#if voiceToasts.length > 0}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none">
		{#each voiceToasts as evt (evt.id)}
			<div
				class="flex items-center gap-3 px-4 py-2.5 pointer-events-auto"
				style="background: rgba(13,13,20,0.97); border: 1px solid rgba(255,255,255,0.07); box-shadow: 0 8px 32px rgba(0,0,0,0.6);"
				transition:fade={{ duration: 200 }}
			>
				{#if evt.avatar}
					<img src={evt.avatar} alt={evt.username} class="w-6 h-6 rounded-full object-cover shrink-0" />
				{:else}
					<div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
					     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
						{evt.username.charAt(0).toUpperCase()}
					</div>
				{/if}
				<span class="text-xs whitespace-nowrap">
					<span class="font-bold" style="color: #e2e8f0">{evt.username}</span>
					<span style="color: #4b5563"> {evt.action === 'join' ? tFn('presence.joined') : tFn('presence.left')} </span>
					<span style="color: var(--nx-accent-2-soft)"># {evt.channelName}</span>
				</span>
				<div class="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
				     style="background: {evt.action === 'join' ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)'};">
					{#if evt.action === 'join'}
						<svg class="w-2.5 h-2.5" fill="none" stroke="#4ade80" stroke-width="2.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
						</svg>
					{:else}
						<svg class="w-2.5 h-2.5" fill="none" stroke="#f87171" stroke-width="2.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/>
						</svg>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- ── Floating Reactions overlay (Layer 2) ──────────────────────────────────
     Écoute les 3 events socket (chat, forum, DM) et fait monter l'emoji
     avec le nom de l'auteur. Le composant est pointer-events:none donc il
     ne bloque jamais un clic. -->
<FloatingReactions />

<!-- ── External Link Warning ─────────────────────────────────────────────────
     Modal éducatif anti-phishing. Activé via le store externalLinkGuard
     quand un composant (MessageBody, etc.) demande à ouvrir un lien externe. -->
<ExternalLinkWarning />

<!-- ── La Scène (partage d'écran) ────────────────────────────────────────────
     Montée ICI, à la RACINE, et surtout PAS dans VoicePanel : celui-ci vit dans
     <aside id="galaxy-sidebar">, qui est `fixed` + `z-30` et crée donc un contexte
     d'empilement. Un enfant en z-[500] y restait prisonnier, et la sidebar des
     membres (z-30, plus loin dans le DOM) peignait par-dessus la Scène : écran
     rogné à droite, en-tête de la Scène (boutons Chat / PiP) invisible.
     À la racine, le plein écran est vraiment plein écran. -->
{#if $stageOpenStore}
	<StageView onclose={() => stageOpenStore.set(false)} />
{/if}

<!-- ── Command Palette ────────────────────────────────────────────────────── -->
<CommandPalette
	open={paletteOpen}
	user={user}
	token={data.token ?? null}
	onClose={() => paletteOpen = false}
/>

<!-- ── Screen share hover preview ────────────────────────────────────────── -->
{#if screenPreview}
	<MemberScreenPreview {...screenPreview} />
{/if}

<style>
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Main content transition during collapse/expand ──────────────────────── */
.nx-shell { background: var(--shell-bg); }

:global(main.app-shell-main) {
  transition: margin-left .42s var(--ease-out-soft), margin-right .42s var(--ease-out-soft);
}

.layout-dragging :global(main.app-shell-main) {
  transition: none !important;
}

/* Contenant flottant : le contenu est lui-même une plaque, décollée des
   panneaux par --shell-gap. Géométrie calculée dans le script (shellVars). */
@media (min-width: 1024px) {
  /* Autour des plaques : le fond du contenant (clair ou sombre), ou le papier
     peint quand l'instance a une bannière. */
  .nx-shell { background: var(--nx-bg); }
  .nx-shell.has-wallpaper { background: transparent; }
  /* Le contenant est calé sur l'écran : c'est la FEUILLE qui défile, jamais le
     document. Sinon, sur une page longue (accueil, forum), la feuille s'étirait
     à la hauteur de son contenu (1931px pour 900 à l'écran, mesuré le 29/09) :
     le haut glissait sous la barre flottante et le bas n'avait plus de fin.
     Jonathan : « il faudrait que cela reste dans une zone définie ». */
  .nx-shell { height: 100dvh; }
  /* Barre de défilement : use:overlayScroll (flottante, respecte les arrondis). */
  /* La feuille de contenu garde le fond de page ACTUEL (--shell-bg) : les
     pages ont encore leurs couleurs sombres codées en dur (hors périmètre du
     CDC), elles deviendraient illisibles sur une feuille claire. */
  :global(main.app-shell-main) {
    margin: var(--shell-gap) var(--shell-gap) var(--shell-gap) var(--shell-left) !important;
    height: calc(100% - var(--shell-gap) * 2) !important;
    border-radius: var(--shell-radius);
    /* --nx-sheet-bg : teinte de l'ambiance en mode sombre (lib/shellTheme.ts) ;
       sinon le fond de page actuel. */
    background: var(--nx-sheet-bg, var(--shell-bg));
    /* Image propre à la feuille : son PROPRE fond (un calque intérieur
       défilerait avec le contenu). Reste en place pendant le défilement. */
    background-image: linear-gradient(var(--zone-img-veil, transparent), var(--zone-img-veil, transparent)), var(--zone-img, none);
    background-position: center, var(--zone-img-pos, 50% 50%);
    background-size: auto, cover;
    background-repeat: no-repeat;
    box-shadow: 0 0 0 1px var(--nx-glass-edge), var(--nx-glass-shadow);
  }
}
@supports (corner-shape: squircle) {
  @media (min-width: 1024px) {
    :global(main.app-shell-main) { corner-shape: squircle; border-radius: calc(var(--shell-radius) * 1.7); }
  }
}

@media (min-width: 1280px) {
  :global(main.app-shell-main) {
    margin-right: calc(var(--shell-gap) + var(--shell-members)) !important;
  }
}



/* ── Voice channel member cards ─────────────────────────────────────────── */
.vc-member-card {
	border-radius: 0;
}
.vc-member-card:hover {
	background: rgba(255,255,255,0.035) !important;
}

/* Animated equalizer bars — shown when a member is speaking */


/* ── Layout channel sub-labels (Texte / Vocal) ───────────────────────────── */
.lch-sublabel {
	display: flex; align-items: center; gap: 5px;
	padding: 8px 10px 3px;
	font-size: 9px; font-weight: 800;
	text-transform: uppercase; letter-spacing: .16em;
	color: #374151;
}
.lch-sublabel svg { width: 10px; height: 10px; shrink: 0; }
.lch-sublabel--voice { color: #14532d; margin-top: 4px; }
.lch-sublabel--voice svg { stroke: #166834; }

.lch-voice-ico { width: 14px; height: 14px; shrink: 0; transition: stroke .15s; }

/* ── Layout channel items — unread glow ──────────────────────────────────── */
.lch-item {
	position: relative;
	overflow: hidden;
	transition: color .15s, background .15s;
	border-radius: 4px;
}
.lch-idle  { color: #4b5563; }
.lch-idle:hover { color: #e2e8f0; background: rgba(255,255,255,.03); }

.lch-active {
	color: #e2e8f0;
	background: rgb(var(--nx-accent-2-rgb) / .12);
}

.lch-unread {
	color: #e2e8f0;
	background: rgb(var(--nx-accent-rgb) / .07);
	box-shadow: inset 2px 0 0 rgb(var(--nx-accent-2-rgb) / .65);
	animation: lch-breathe 2.8s ease-in-out infinite;
}
.lch-unread:hover { background: rgb(var(--nx-accent-rgb) / .13); }

@keyframes lch-breathe {
	0%,100% {
		box-shadow: inset 2px 0 0 rgb(var(--nx-accent-2-rgb) / .5);
		background: rgb(var(--nx-accent-rgb) / .06);
	}
	50% {
		box-shadow: inset 2px 0 0 rgba(167,139,250,.95), 0 0 12px rgb(var(--nx-accent-rgb) / .12);
		background: rgb(var(--nx-accent-rgb) / .11);
	}
}

.lch-flash::after {
	content: '';
	position: absolute;
	inset: 0;
	background: linear-gradient(
		90deg,
		transparent 0%,
		rgb(var(--nx-accent-rgb) / .2) 35%,
		rgba(167,139,250,.28) 50%,
		rgb(var(--nx-accent-rgb) / .2) 65%,
		transparent 100%
	);
	transform: translateX(-110%);
	animation: lch-sweep .55s cubic-bezier(.4,0,.2,1) forwards;
	pointer-events: none;
}
@keyframes lch-sweep {
	from { transform: translateX(-110%); }
	to   { transform: translateX(110%); }
}

.lch-badge {
	shrink: 0;
	min-width: 15px;
	height: 15px;
	padding: 0 4px;
	border-radius: 99px;
	background: var(--nx-accent-2-strong);
	color: white;
	font-size: 8px;
	font-weight: 800;
	text-align: center;
	line-height: 15px;
	animation: lch-badge-pop .2s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes lch-badge-pop {
	from { transform: scale(0); opacity: 0; }
	to   { transform: scale(1); opacity: 1; }
}

/* ── Language view (state-swapped, no route) ────────────────────────────── */
.lang-view-wrap {
    background: rgba(6, 6, 10, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: #e2e8f0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.lang-back {
    transition: all 200ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.lang-back:hover { color: #fff; border-color: rgba(255,255,255,0.25); }
.lang-back:active { transform: scale(0.98); }
.lang-back:focus-visible { outline: none; border-color: var(--nx-accent); }
.lang-card {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
.lang-icon {
    border-color: rgba(var(--nx-accent-rgb), 0.2);
    background: rgba(var(--nx-accent-rgb), 0.1);
    color: var(--nx-accent-soft);
}
.lang-title {
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.03em;
}
.lang-label {
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.005em;
}
.lang-segments {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.06) transparent;
}
.lang-segments::-webkit-scrollbar { width: 5px; position: absolute; }
.lang-segments::-webkit-scrollbar-track { background: transparent; }
.lang-segments::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius: 99px; }
.lang-segments::-webkit-scrollbar-thumb:hover { background: rgba(var(--nx-accent-rgb), 0.4); }
.lang-seg {
    transition: all 300ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.lang-seg::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 2px;
    background: linear-gradient(180deg, var(--nx-accent), var(--nx-accent-2));
    opacity: 0;
    transform: translateX(-100%);
    transition: all 300ms cubic-bezier(0.25, 0.1, 0.25, 1);
    box-shadow: 0 0 8px var(--nx-accent);
}
.lang-seg:hover {
    border-color: rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04);
}
.lang-seg:active {
    transform: scale(0.98);
    background: rgba(255, 255, 255, 0.05);
    transition: transform 100ms ease-out, background 100ms ease-out;
}
.lang-seg:focus-visible {
    outline: none;
    border-color: var(--nx-accent);
    box-shadow: 0 0 0 3px rgba(var(--nx-accent-rgb), 0.3);
}
.lang-seg.active {
    border-color: #4f46e5;
    background: #4f46e5;
}
.lang-seg.active::before { opacity: 1; transform: translateX(0); }
.lang-seg.active .text-slate-200 { color: #fff; }
.lang-seg.active .lang-seg-check { color: #fff; }
.lang-seg-check {
    color: var(--nx-accent);
    transform: scale(0);
    transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.lang-seg.active .lang-seg-check { transform: scale(1); }
.lang-success {
    animation: lang-success-in 200ms ease-out;
}
@keyframes lang-success-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* ── Reduced motion ──────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
    .lang-back,
    .lang-seg,
    .lang-seg::before,
    .lang-seg-check,
    .lang-success {
        transition: none !important;
        animation: none !important;
        transform: none !important;
    }
}

</style>
