<!--
  Mémo audio self-hosted.

  Pipeline :
  1. Click sur le bouton micro → demande permission micro → MediaRecorder.start()
  2. Affichage UI live :
     - Pastille rouge pulsante "REC"
     - Timer mm:ss / 01:00 max
     - Mini visualizer (5 barres animées via AnalyserNode)
     - Bouton stop + bouton annuler
  3. Stop → blob audio/webm → preview avec <audio controls> + bouton envoyer
  4. Envoyer → upload via /api/v1/social/upload → callback onsend(url)

  Self-hosted, zero service tiers. Le blob est uploadé sur l'instance.
-->
<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { onDestroy } from 'svelte'

	interface Props {
		token:  string | null
		onsend: (url: string) => void
	}
	let { token, onsend }: Props = $props()

	const MAX_DURATION_S = 60

	// État de la machine : idle → recording → preview → uploading
	let phase = $state<'idle' | 'recording' | 'preview' | 'uploading'>('idle')
	let elapsed = $state(0)              // secondes
	let levels  = $state<number[]>([0,0,0,0,0])  // 5 barres 0..1
	let previewUrl = $state<string | null>(null)

	// Resources
	let mediaRecorder: MediaRecorder | null = null
	let audioStream:   MediaStream    | null = null
	let audioCtx:      AudioContext   | null = null
	let analyser:      AnalyserNode   | null = null
	let rafHandle:     number         | null = null
	let timerHandle:   ReturnType<typeof setInterval> | null = null
	let chunks: Blob[] = []
	let recordedBlob:  Blob | null = null
	let recordedMime = 'audio/webm'

	function pickMime(): string {
		// Pas tous les browsers supportent webm/opus. Fallback en cascade.
		const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
		if (typeof MediaRecorder === 'undefined') return ''
		for (const m of candidates) {
			if (MediaRecorder.isTypeSupported(m)) return m
		}
		return ''
	}

	async function start() {
		try {
			audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
		} catch (err) {
			console.warn('[AudioRecorder] permission micro refusée', err)
			return
		}
		const mime = pickMime()
		try {
			mediaRecorder = mime
				? new MediaRecorder(audioStream, { mimeType: mime })
				: new MediaRecorder(audioStream)
		} catch (err) {
			console.error('[AudioRecorder] MediaRecorder unsupported', err)
			stopStream()
			return
		}
		recordedMime = mediaRecorder.mimeType || mime || 'audio/webm'
		chunks = []
		mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
		mediaRecorder.onstop = onStop
		mediaRecorder.start(250)

		// Setup visualizer
		try {
			audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
			const source = audioCtx.createMediaStreamSource(audioStream)
			analyser = audioCtx.createAnalyser()
			analyser.fftSize = 64
			source.connect(analyser)
			rafHandle = requestAnimationFrame(tickVisualizer)
		} catch { /* ignore, visualizer optional */ }

		// Timer
		elapsed = 0
		timerHandle = setInterval(() => {
			elapsed += 1
			if (elapsed >= MAX_DURATION_S) stop()
		}, 1000)

		phase = 'recording'
	}

	function tickVisualizer() {
		if (!analyser) return
		const buf = new Uint8Array(analyser.frequencyBinCount)
		analyser.getByteFrequencyData(buf)
		// Découpe en 5 bandes
		const bandSize = Math.floor(buf.length / 5)
		const out: number[] = []
		for (let i = 0; i < 5; i++) {
			let sum = 0
			for (let j = 0; j < bandSize; j++) sum += buf[i * bandSize + j]
			out.push(Math.min(1, sum / (bandSize * 180)))
		}
		levels = out
		rafHandle = requestAnimationFrame(tickVisualizer)
	}

	function stopStream() {
		audioStream?.getTracks().forEach(t => t.stop())
		audioStream = null
		if (rafHandle) cancelAnimationFrame(rafHandle); rafHandle = null
		if (timerHandle) clearInterval(timerHandle); timerHandle = null
		audioCtx?.close().catch(() => {})
		audioCtx = null
		analyser = null
	}

	function stop() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop()
		}
	}

	function onStop() {
		stopStream()
		const blob = new Blob(chunks, { type: recordedMime })
		recordedBlob = blob
		previewUrl = URL.createObjectURL(blob)
		phase = 'preview'
	}

	function cancel() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.onstop = null  // empêche onStop de générer un preview
			mediaRecorder.stop()
		}
		stopStream()
		if (previewUrl) URL.revokeObjectURL(previewUrl)
		previewUrl = null
		recordedBlob = null
		elapsed = 0
		phase = 'idle'
	}

	async function send() {
		if (!recordedBlob || !token) return
		phase = 'uploading'
		try {
			const ext = recordedMime.includes('mp4') ? 'm4a'
			          : recordedMime.includes('ogg') ? 'ogg'
			          : 'webm'
			const form = new FormData()
			form.append('file', recordedBlob, `memo-${Date.now()}.${ext}`)
			const res = await apiFetch(fetch, '/social/upload', {
				method:  'POST',
				body:    form,
				headers: { Authorization: `Bearer ${token}` },
			})
			if (!res.ok) {
				console.error('[AudioRecorder] upload failed', res.status)
				phase = 'preview'
				return
			}
			const { url } = await res.json() as { url: string }
			onsend(url)
			if (previewUrl) URL.revokeObjectURL(previewUrl)
			previewUrl = null
			recordedBlob = null
			elapsed = 0
			phase = 'idle'
		} catch (err) {
			console.error('[AudioRecorder] send error', err)
			phase = 'preview'
		}
	}

	function fmt(s: number): string {
		const m = Math.floor(s / 60)
		const ss = (s % 60).toString().padStart(2, '0')
		return `${m}:${ss}`
	}

	onDestroy(() => {
		cancel()
	})
</script>

{#if phase === 'idle'}
	<button
		type="button"
		onclick={start}
		class="ar-btn-mic"
		title="Enregistrer un mémo audio (60s max)"
		aria-label="Enregistrer un mémo audio"
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
			<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
			<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
			<line x1="12" y1="19" x2="12" y2="23"/>
			<line x1="8" y1="23" x2="16" y2="23"/>
		</svg>
	</button>
{:else if phase === 'recording'}
	<div class="ar-recording">
		<span class="ar-rec-dot" aria-hidden="true"></span>
		<span class="ar-rec-timer">{fmt(elapsed)} / {fmt(MAX_DURATION_S)}</span>
		<div class="ar-viz">
			{#each levels as l, i (i)}
				<span class="ar-bar" style="--h: {Math.max(0.15, l)}"></span>
			{/each}
		</div>
		<button type="button" onclick={stop} class="ar-btn-stop" title="Arrêter et écouter">
			<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
		</button>
		<button type="button" onclick={cancel} class="ar-btn-cancel" title="Annuler">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5">
				<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>
	</div>
{:else if phase === 'preview' && previewUrl}
	<div class="ar-preview">
		<audio src={previewUrl} controls class="ar-audio"></audio>
		<button type="button" onclick={send} class="ar-btn-send" title="Envoyer ce mémo">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5">
				<line x1="22" y1="2" x2="11" y2="13"/>
				<polygon points="22 2 15 22 11 13 2 9 22 2"/>
			</svg>
		</button>
		<button type="button" onclick={cancel} class="ar-btn-cancel" title="Jeter">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-3.5 h-3.5">
				<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>
	</div>
{:else if phase === 'uploading'}
	<div class="ar-uploading">
		<span class="ar-spin"></span>
		<span class="ar-uploading-label">Envoi…</span>
	</div>
{/if}

<style>
	.ar-btn-mic {
		width: 32px;
		height: 32px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
		transition: background .15s, color .15s;
	}
	.ar-btn-mic:hover { background: rgba(255,255,255,.06); color: #e5e7eb; }

	.ar-recording {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 10px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.22);
		border-radius: 999px;
	}
	.ar-rec-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #ef4444;
		box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6);
		animation: ar-pulse 1.2s ease-in-out infinite;
		flex-shrink: 0;
	}
	@keyframes ar-pulse {
		0%, 100% { box-shadow: 0 0 0 0   rgba(239, 68, 68, 0.5); transform: scale(1); }
		50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);   transform: scale(1.15); }
	}
	.ar-rec-timer {
		font-size: 11px;
		font-family: ui-monospace, SFMono-Regular, monospace;
		color: #fecaca;
		font-variant-numeric: tabular-nums;
		min-width: 64px;
		text-align: center;
	}
	.ar-viz {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 14px;
	}
	.ar-bar {
		display: block;
		width: 3px;
		height: calc(14px * var(--h, 0.2));
		min-height: 2px;
		border-radius: 1.5px;
		background: linear-gradient(to top, #fca5a5, #fecaca);
		transition: height .08s ease-out;
	}
	.ar-btn-stop, .ar-btn-cancel, .ar-btn-send {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		transition: background .15s;
	}
	.ar-btn-stop {
		background: rgba(239, 68, 68, 0.18);
		color: #fca5a5;
	}
	.ar-btn-stop:hover { background: rgba(239, 68, 68, 0.32); }
	.ar-btn-cancel {
		background: transparent;
		color: rgba(252, 165, 165, 0.7);
	}
	.ar-btn-cancel:hover { background: rgba(255,255,255,.06); color: #e5e7eb; }
	.ar-btn-send {
		background: rgb(var(--nx-accent-rgb) / 0.18);
		color: #a5b4fc;
	}
	.ar-btn-send:hover { background: rgb(var(--nx-accent-rgb) / 0.32); color: #c7d2fe; }

	.ar-preview {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		background: rgb(var(--nx-accent-rgb) / 0.06);
		border: 1px solid rgb(var(--nx-accent-rgb) / 0.18);
		border-radius: 12px;
		max-width: 100%;
	}
	.ar-audio { height: 30px; flex: 1; min-width: 200px; max-width: 320px; }
	.ar-audio::-webkit-media-controls-panel { background: rgba(15,15,22,0.5); }

	.ar-uploading {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		background: rgb(var(--nx-accent-rgb) / 0.08);
		border: 1px solid rgb(var(--nx-accent-rgb) / 0.22);
		border-radius: 999px;
		color: #c7d2fe;
		font-size: 12px;
	}
	.ar-spin {
		width: 10px;
		height: 10px;
		border: 2px solid var(--nx-accent-soft);
		border-top-color: transparent;
		border-radius: 50%;
		animation: ar-spin 0.7s linear infinite;
	}
	@keyframes ar-spin { to { transform: rotate(360deg); } }
	.ar-uploading-label { font-family: ui-monospace, SFMono-Regular, monospace; }
</style>
