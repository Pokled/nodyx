<script lang="ts">
	// Monte une surface d'extension dans une iframe isolée.
	//
	// Tout ce qui compte pour la sécurité tient en deux endroits : l'attribut
	// `sandbox` ci dessous, et le fait que l'hôte n'envoie QU'UN message sur
	// `window`, celui qui transfère le port privé. Le reste du pont vit dans
	// `$lib/extensions/host`, séparé pour être testable et relisible comme une
	// frontière plutôt que comme du code d'interface.
	//
	// cf SPECS/NODYX_SDK_CDC.md §4

	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { createHostHandler, buildBootPayload, frameUrl, createStorageCaller, type HostSurface } from '$lib/extensions/host'

	const tFn = $derived($t)

	interface Props {
		extensionId: string
		version:     string
		/** 'page' ou 'widget:<id>' */
		surface:     string
		/** Chemin du point d'entrée déclaré par la surface, ex. 'ui/widget.js' */
		entry:       string
		label:       string
		config?:     Record<string, unknown>
		messages?:   Record<string, string>
		locale?:     string
		theme?:      Record<string, string>
		instance?:   Record<string, unknown>
		defaultHeight?: number
		/** Une page occupe la zone de contenu, un widget suit sa hauteur. */
		fill?:       boolean
	}

	let {
		extensionId, version, surface, entry, label,
		config = {}, messages = {}, locale = 'fr', theme = {},
		instance = {}, defaultHeight = 160, fill = false,
	}: Props = $props()

	// L'identite N'EST PAS une propriete : elle vient de la route de session,
	// projetee cote serveur selon ce que l'admin a accorde. Un composant ne
	// peut donc pas passer par erreur l'objet utilisateur entier.
	let token: string | null = null
	let grantedUser: Record<string, unknown> | null = null

	let frame:  HTMLIFrameElement | null = $state(null)
	let status: 'loading' | 'ready' | 'error' = $state('loading')
	let height  = $state(defaultHeight)
	let channel: MessageChannel | null = null
	let bootTimer: ReturnType<typeof setTimeout> | null = null

	const ref: HostSurface = $derived({ extensionId, version, surface })
	const src = $derived(frameUrl({ extensionId, version, surface }))

	const handle = createHostHandler(
		{ extensionId, version, surface },
		{
			resize: (h) => { if (!fill) height = h },
			toast:  (message) => { console.info('[extension]', extensionId, message) },
			// Les autres actions arrivent avec les lots suivants : le pont répond
			// déjà « pas encore » avec un code explicite, ce qui vaut mieux qu'un
			// silence pour qui développe une extension.
		},
		{ storage: createStorageCaller({ extensionId, version, surface }, () => token) },
	)

	/** Frappe le jeton de surface et récupère l'identité projetée. */
	async function openSession(): Promise<boolean> {
		try {
			const res = await fetch(`/api/v1/extensions/${extensionId}/session`, {
				method:  'POST',
				headers: { 'content-type': 'application/json' },
				body:    JSON.stringify({ surface }),
			})
			if (!res.ok) return false
			const body = await res.json()
			token       = body.token ?? null
			grantedUser = body.user  ?? null
			return Boolean(token)
		} catch {
			return false
		}
	}

	function onWindowMessage(e: MessageEvent) {
		// `e.origin` vaut "null" pour une frame en origine opaque, donc il ne
		// prouve rien. La seule vérification qui vaille est la fenêtre source.
		if (!frame || e.source !== frame.contentWindow) return
		if (e.data?.type !== 'nodyx:hello') return

		channel = new MessageChannel()
		channel.port1.onmessage = async (ev) => {
			if (ev.data?.event === 'ready') { status = 'ready'; clearBootTimer(); return }
			if (ev.data?.event === 'error') { status = 'error'; clearBootTimer(); return }
			const answer = await handle(ev.data)
			if (answer) channel?.port1.postMessage(answer)
		}
		channel.port1.start()

		const boot = buildBootPayload(ref, window.location.origin, entry, {
			config, messages, locale, theme, instance, user: grantedUser, route: '/',
		})
		// Cible '*' : la frame est en origine opaque, aucune autre valeur ne
		// correspondrait. Ce n'est pas une faiblesse, le message ne contient rien
		// de secret et il ne part que vers cette frame précise.
		frame.contentWindow?.postMessage(boot, '*', [channel.port2])
	}

	function clearBootTimer() {
		if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
	}

	onMount(() => {
		if (!browser) return
		window.addEventListener('message', onWindowMessage)
		bootTimer = setTimeout(() => { if (status === 'loading') status = 'error' }, 5000)
		// Sans jeton la surface s'affiche quand même : elle n'aura simplement
		// aucune capacité, ce que le pont lui dira avec un code explicite.
		void openSession()
	})

	onDestroy(() => {
		if (!browser) return
		window.removeEventListener('message', onWindowMessage)
		clearBootTimer()
		channel?.port1.close()
	})
</script>

<!--
  Le marqueur d'origine est dessiné par l'HÔTE, hors de la frame, donc une
  extension ne peut pas l'imiter ni le masquer. Sans lui, une fausse invite de
  connexion dessinée dans un widget serait indiscernable de la vraie.
  cf NODYX_SDK_SECURITY.md §4.9, garantie G10
-->
<div class="ext" class:ext--fill={fill}>
	<div class="ext-marker" aria-label={tFn('ext.marker_aria', { name: label })}>
		<span class="ext-marker-dot" aria-hidden="true"></span>
		<span class="ext-marker-label">{label}</span>
	</div>

	{#if status === 'error'}
		<div class="ext-error">{tFn('ext.failed', { name: label })}</div>
	{/if}

	<iframe
		bind:this={frame}
		{src}
		title={label}
		sandbox="allow-scripts"
		referrerpolicy="no-referrer"
		loading="lazy"
		class="ext-frame"
		class:ext-frame--hidden={status === 'error'}
		style={fill ? '' : `height:${height}px`}
	></iframe>

	{#if status === 'loading'}
		<div class="ext-loading">{tFn('ext.loading')}</div>
	{/if}
</div>

<style>
	.ext {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.ext--fill { flex: 1; min-height: 0; }

	.ext-marker {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		font-size: 10px;
		letter-spacing: .04em;
		text-transform: uppercase;
		color: var(--nx-text-muted, #6b7280);
	}
	.ext-marker-dot {
		width: 5px; height: 5px;
		border-radius: 999px;
		background: var(--nx-accent-2-soft, #a78bfa);
		flex: none;
	}
	.ext-marker-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ext-frame {
		width: 100%;
		border: 0;
		display: block;
		background: transparent;
	}
	.ext--fill .ext-frame { flex: 1; height: 100%; }
	.ext-frame--hidden { display: none; }

	.ext-loading, .ext-error {
		padding: 12px;
		font-size: 12px;
		color: var(--nx-text-muted, #6b7280);
	}
	.ext-error { color: #fca5a5; }
</style>
