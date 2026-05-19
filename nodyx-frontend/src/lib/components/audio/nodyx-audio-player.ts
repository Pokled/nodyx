// <nodyx-audio-player src="/uploads/posts/xxx.mp3"
//                     track-title="..."   artist="..."   cover="..."   download="1">
//
// Web Component with:
//  - SoundCloud-style waveform timeline (peaks computed via WebAudio decode)
//  - Click-to-seek on waveform
//  - Cover, title, artist
//  - Speed cycler (0.75 / 1 / 1.25 / 1.5 / 2x)
//  - Volume + mute with barred-speaker icon
//  - Download (opt-in by post author)
//  - Share menu: copy link + copy link at current timestamp
//  - Auto-seek + auto-play from `#audio-{id}=t{seconds}` URL hash
//
// Shared AudioContext to stay under Chrome's 6-context-per-origin cap.
// Defined once at app startup from +layout.svelte. Re-defines are guarded.

const TAG = 'nodyx-audio-player'

let _sharedCtx: AudioContext | null = null
function getSharedCtx(): AudioContext | null {
	if (_sharedCtx) return _sharedCtx
	const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
	if (!Ctor) return null
	_sharedCtx = new Ctor()
	return _sharedCtx
}

function fmtTime(sec: number): string {
	if (!isFinite(sec) || sec < 0) return '0:00'
	const m = Math.floor(sec / 60)
	const s = Math.floor(sec % 60)
	return `${m}:${s.toString().padStart(2, '0')}`
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

const BAR_COUNT  = 96
const EQ_BARS    = 28
const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2]

interface Track {
	src:    string
	title?: string
	artist?:string
	cover?: string
}

// Cache decoded peaks per src so multiple players for the same file share work
const _peaksCache = new Map<string, Float32Array>()

async function computeWaveformPeaks(src: string, bars = BAR_COUNT): Promise<Float32Array | null> {
	if (_peaksCache.has(src)) return _peaksCache.get(src)!
	const ctx = getSharedCtx()
	if (!ctx) return null
	try {
		const res = await fetch(src, { credentials: 'same-origin' })
		if (!res.ok) return null
		const buf = await res.arrayBuffer()
		// decodeAudioData detaches the buffer in older Safari; clone first
		const decoded = await ctx.decodeAudioData(buf.slice(0))
		const chan = decoded.getChannelData(0)
		const samplesPerBar = Math.max(1, Math.floor(chan.length / bars))
		const peaks = new Float32Array(bars)
		let globalMax = 0
		for (let i = 0; i < bars; i++) {
			const start = i * samplesPerBar
			const end   = Math.min(start + samplesPerBar, chan.length)
			let max = 0
			for (let j = start; j < end; j += 8) {  // step 8 for perf — ~4x faster, same shape
				const v = Math.abs(chan[j])
				if (v > max) max = v
			}
			peaks[i] = max
			if (max > globalMax) globalMax = max
		}
		// Normalize to [0..1], leave a tiny floor so silent sections still draw a hair
		const norm = globalMax > 0 ? 1 / globalMax : 1
		for (let i = 0; i < bars; i++) peaks[i] = Math.max(0.04, peaks[i] * norm)
		_peaksCache.set(src, peaks)
		return peaks
	} catch (err) {
		console.warn('[nodyx-audio] waveform decode failed', err)
		return null
	}
}

function playerIdFromSrc(src: string): string {
	const last = src.split('/').pop() || src
	return last.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'audio'
}

class NodyxAudioPlayer extends HTMLElement {
	private _audio!: HTMLAudioElement
	private _shadow!: ShadowRoot
	private _canvas!: HTMLCanvasElement
	private _ctx2d: CanvasRenderingContext2D | null = null
	private _eqCanvas!: HTMLCanvasElement
	private _eqCtx2d: CanvasRenderingContext2D | null = null
	private _eqBars: Float32Array = new Float32Array(EQ_BARS)
	private _eqPeaks: Float32Array = new Float32Array(EQ_BARS)
	private _analyser: AnalyserNode | null = null
	private _srcNode: MediaElementAudioSourceNode | null = null
	private _gainNode: GainNode | null = null
	private _peaks: Float32Array | null = null
	private _idle: Float32Array = new Float32Array(BAR_COUNT)  // placeholder until peaks load
	private _hoverPct: number | null = null
	private _eqRaf: number | null = null
	private _initialised = false
	private _muted = false
	private _lastVolume = 0.85
	private _speedIdx = 1
	private _playerId = 'audio'

	// Playlist
	private _tracks: Track[] = []
	private _currentIdx = 0
	private _shuffle = false
	private _history: number[] = []

	// UI refs
	private _wrap!: HTMLDivElement
	private _playBtn!: HTMLButtonElement
	private _coverImg!: HTMLImageElement
	private _titleEl!: HTMLSpanElement
	private _artistEl!: HTMLSpanElement
	private _metaRow!: HTMLDivElement
	private _curEl!: HTMLSpanElement
	private _totalEl!: HTMLSpanElement
	private _volEl!: HTMLInputElement
	private _volBtn!: HTMLButtonElement
	private _dlBtn!: HTMLAnchorElement
	private _speedBtn!: HTMLButtonElement
	private _shareBtn!: HTMLButtonElement
	private _shareMenu!: HTMLDivElement
	private _toast!: HTMLDivElement
	private _prevBtn!: HTMLButtonElement
	private _nextBtn!: HTMLButtonElement
	private _shuffleBtn!: HTMLButtonElement
	private _listBtn!: HTMLButtonElement
	private _tracklistEl!: HTMLDivElement

	static get observedAttributes() {
		return ['src', 'track-title', 'artist', 'cover', 'download']
	}

	constructor() {
		super()
		this._audio = new Audio()
		this._audio.preload = 'metadata'
		this._audio.crossOrigin = 'anonymous'
		// Idle placeholder: random-ish, deterministic shape
		for (let i = 0; i < BAR_COUNT; i++) this._idle[i] = 0.15 + 0.18 * Math.abs(Math.sin(i * 0.6))
	}

	connectedCallback() {
		if (this._initialised) return
		this._initialised = true
		this._shadow = this.attachShadow({ mode: 'open' })
		this._renderUI()
		this._bindUI()
		this._readTracks()
		this._renderTracklist()
		this._wrap.classList.toggle('has-playlist', this._tracks.length > 1)
		if (this._tracks.length > 0) {
			this._loadTrack(0, false)
		} else {
			this._syncFromAttrs()
		}
		this._maybeAutoSeek()
	}

	private _readTracks() {
		// Build playlist from child <nodyx-track> elements
		const children = this.querySelectorAll('nodyx-track')
		if (children.length > 0) {
			this._tracks = Array.from(children).map(el => ({
				src:    el.getAttribute('src')         || '',
				title:  el.getAttribute('track-title') || undefined,
				artist: el.getAttribute('artist')      || undefined,
				cover:  el.getAttribute('cover')       || undefined,
			})).filter(t => t.src)
			return
		}
		// Legacy single-track from top-level attrs
		const src = this.getAttribute('src')
		if (src) {
			this._tracks = [{
				src,
				title:  this.getAttribute('track-title') || undefined,
				artist: this.getAttribute('artist')      || undefined,
				cover:  this.getAttribute('cover')       || undefined,
			}]
		}
	}

	private _loadTrack(idx: number, autoplay: boolean) {
		if (idx < 0 || idx >= this._tracks.length) return
		this._currentIdx = idx
		const t = this._tracks[idx]

		// Push current onto history before switching (so prev works)
		if (this._history[this._history.length - 1] !== idx) this._history.push(idx)
		if (this._history.length > 64) this._history.shift()

		// Update player UI to match this track
		this._titleEl.textContent  = t.title  || ''
		this._artistEl.textContent = t.artist || ''
		this._metaRow.style.display = (t.title || t.artist) ? 'flex' : 'none'

		const playerCover = this.getAttribute('cover') || ''
		const effectiveCover = t.cover || playerCover
		if (effectiveCover) {
			this._coverImg.src = effectiveCover
			this._wrap.classList.add('has-cover')
		} else {
			this._coverImg.removeAttribute('src')
			this._wrap.classList.remove('has-cover')
		}

		this._playerId = playerIdFromSrc(t.src)
		const fullUrl = new URL(t.src, location.href).href
		if (this._audio.src !== fullUrl) {
			this._audio.src = t.src
			this._loadPeaks(t.src)
		}

		const download = this.getAttribute('download') || ''
		if (download) {
			this._dlBtn.href = t.src
			this._dlBtn.setAttribute('download', '')
			this._dlBtn.style.display = ''
		} else {
			this._dlBtn.style.display = 'none'
		}

		this._refreshTracklistActive()
		if (autoplay) this._audio.play().catch(() => {})
	}

	private _renderTracklist() {
		if (this._tracks.length <= 1) {
			this._tracklistEl.innerHTML = ''
			return
		}
		const rows = this._tracks.map((t, i) => {
			const title = t.title || t.src.split('/').pop() || `Piste ${i + 1}`
			const artist = t.artist ? ` <span class="tl-artist">— ${escapeHtml(t.artist)}</span>` : ''
			return `<button type="button" class="tl-row" data-idx="${i}">
				<span class="tl-num">${i + 1}.</span>
				<span class="tl-title">${escapeHtml(title)}${artist}</span>
			</button>`
		}).join('')
		this._tracklistEl.innerHTML = `<div class="tl-head">${this._tracks.length} pistes</div>${rows}`
		this._tracklistEl.querySelectorAll<HTMLButtonElement>('.tl-row').forEach(btn => {
			btn.addEventListener('click', () => {
				const idx = parseInt(btn.getAttribute('data-idx') || '0', 10)
				this._loadTrack(idx, true)
				this._closeTracklist()
			})
		})
		this._refreshTracklistActive()
	}

	private _refreshTracklistActive() {
		this._tracklistEl.querySelectorAll<HTMLButtonElement>('.tl-row').forEach(btn => {
			const idx = parseInt(btn.getAttribute('data-idx') || '0', 10)
			btn.classList.toggle('is-active', idx === this._currentIdx)
		})
	}

	private _toggleTracklist() {
		this._tracklistEl.classList.toggle('open')
	}

	private _closeTracklist() {
		this._tracklistEl.classList.remove('open')
	}

	private _prev() {
		if (this._tracks.length <= 1) return
		// Use history if we have something other than the current track
		const filtered = this._history.filter(i => i !== this._currentIdx)
		if (filtered.length > 0) {
			const back = filtered[filtered.length - 1]
			this._history = this._history.slice(0, this._history.lastIndexOf(back))
			this._loadTrack(back, true)
		} else {
			const idx = (this._currentIdx - 1 + this._tracks.length) % this._tracks.length
			this._loadTrack(idx, true)
		}
	}

	private _next() {
		if (this._tracks.length <= 1) return
		let idx: number
		if (this._shuffle) {
			if (this._tracks.length === 2) {
				idx = (this._currentIdx + 1) % 2
			} else {
				do { idx = Math.floor(Math.random() * this._tracks.length) }
				while (idx === this._currentIdx)
			}
		} else {
			idx = (this._currentIdx + 1) % this._tracks.length
		}
		this._loadTrack(idx, true)
	}

	private _toggleShuffle() {
		this._shuffle = !this._shuffle
		this._shuffleBtn.classList.toggle('is-on', this._shuffle)
		this._shuffleBtn.setAttribute('aria-pressed', String(this._shuffle))
	}

	disconnectedCallback() {
		try { this._audio.pause() } catch {}
		if (this._eqRaf !== null) cancelAnimationFrame(this._eqRaf)
		this._eqRaf = null
	}

	attributeChangedCallback(_name: string, _old: string | null, _val: string | null) {
		if (this._initialised) this._syncFromAttrs()
	}

	private _syncFromAttrs() {
		const src = this.getAttribute('src') || ''
		if (src && this._audio.src !== new URL(src, location.href).href) {
			this._audio.src = src
			this._playerId = playerIdFromSrc(src)
			this._loadPeaks(src)
		}

		const title    = this.getAttribute('track-title') || ''
		const artist   = this.getAttribute('artist')      || ''
		const cover    = this.getAttribute('cover')       || ''
		const download = this.getAttribute('download')    || ''

		this._titleEl.textContent  = title
		this._artistEl.textContent = artist
		this._metaRow.style.display = (title || artist) ? 'flex' : 'none'

		if (cover) {
			this._coverImg.src = cover
			this._wrap.classList.add('has-cover')
		} else {
			this._coverImg.removeAttribute('src')
			this._wrap.classList.remove('has-cover')
		}

		if (download && src) {
			this._dlBtn.href = src
			this._dlBtn.setAttribute('download', '')
			this._dlBtn.style.display = ''
		} else {
			this._dlBtn.style.display = 'none'
		}
	}

	private async _loadPeaks(src: string) {
		this._peaks = null
		this._drawWaveform()
		const peaks = await computeWaveformPeaks(src)
		// Make sure we're still mounted and pointing at the same src
		if (this._audio.src && this._audio.src.endsWith(src.split('/').pop() || '')) {
			this._peaks = peaks
			this._drawWaveform()
		}
	}

	private _maybeAutoSeek() {
		const hash = window.location.hash
		if (!hash) return
		const m = hash.match(/#audio-([^=&]+)(?:=t(\d+))?/)
		if (!m) return
		if (m[1] !== this._playerId) return
		const seconds = m[2] ? parseInt(m[2], 10) : 0
		const apply = () => {
			if (seconds > 0) this._audio.currentTime = seconds
			this._audio.play().catch(() => {})
		}
		if (this._audio.readyState >= 1) apply()
		else this._audio.addEventListener('loadedmetadata', apply, { once: true })
	}

	private _renderUI() {
		this._shadow.innerHTML = `
			<style>
				:host { display: block; margin: 12px 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #e0e7ff; }
				.wrap {
					position: relative;
					display: grid;
					grid-template-columns: 56px 1fr auto;
					gap: 10px 14px;
					padding: 14px 16px;
					border-radius: 14px;
					background:
						radial-gradient(circle at 0% 0%, rgba(99,102,241,0.18) 0, transparent 60%),
						radial-gradient(circle at 100% 100%, rgba(236,72,153,0.14) 0, transparent 60%),
						linear-gradient(160deg, #1e1b4b 0%, #0f172a 100%);
					border: 1px solid rgba(99,102,241,0.35);
					box-shadow:
						inset 0 1px 0 rgba(255,255,255,0.05),
						0 6px 24px -8px rgba(99,102,241,0.35);
				}
				.wrap.has-cover { grid-template-columns: 56px 80px 1fr auto; }

				/* Cover sits in its own column, fully visible, clickable for play/pause */
				.cover-wrap {
					display: none;
					align-self: center;
				}
				.wrap.has-cover .cover-wrap { display: block; }
				.cover {
					width: 80px; height: 80px;
					border-radius: 10px;
					object-fit: cover;
					box-shadow: 0 4px 14px -4px rgba(0,0,0,0.6);
					border: 1px solid rgba(99,102,241,0.3);
					cursor: pointer;
					transition: transform 160ms ease, box-shadow 200ms ease;
				}
				.cover:hover {
					transform: scale(1.03);
					box-shadow: 0 6px 18px -4px rgba(236,72,153,0.45);
				}

				/* Standalone play button (never overlays the cover) */
				.play {
					align-self: center;
					width: 56px; height: 56px;
					border-radius: 50%;
					border: 0; cursor: pointer;
					background: linear-gradient(140deg, #6366f1 0%, #8b5cf6 60%, #ec4899 100%);
					box-shadow: 0 6px 18px -4px rgba(99,102,241,0.6), inset 0 1px 0 rgba(255,255,255,0.25);
					color: #fff;
					display: flex; align-items: center; justify-content: center;
					transition: transform 120ms ease, box-shadow 200ms ease;
				}
				.play:hover { transform: scale(1.05); box-shadow: 0 8px 22px -4px rgba(236,72,153,0.55); }
				.play:active { transform: scale(0.97); }
				.play svg { width: 22px; height: 22px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4)); }
				.play.is-playing svg.play-icon { display: none; }
				.play:not(.is-playing) svg.pause-icon { display: none; }

				.main { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-self: center; }
				.meta { display: flex; gap: 8px; min-width: 0; align-items: baseline; }
				.title { font-size: 13px; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.artist { font-size: 11px; color: #a5b4fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.artist:not(:empty)::before { content: '— '; color: #64748b; }

				/* Equalizer: real-time FFT bars (smaller, on top of waveform) */
				.eq { position: relative; height: 32px; border-radius: 6px; overflow: hidden; background: rgba(15,23,42,0.5); border: 1px solid rgba(99,102,241,0.15); }
				.eq canvas { display: block; width: 100%; height: 100%; }

				/* Waveform — SoundCloud-style timeline, clickable to seek */
				.viz { position: relative; height: 48px; border-radius: 8px; overflow: hidden; background: rgba(15,23,42,0.55); border: 1px solid rgba(99,102,241,0.18); cursor: pointer; }
				.viz canvas { display: block; width: 100%; height: 100%; }

				.controls { display: flex; align-items: center; gap: 10px; }
				.time { font-variant-numeric: tabular-nums; font-size: 11px; color: #a5b4fc; letter-spacing: 0.02em; }

				/* Right column */
				.side {
					display: flex; flex-direction: column; align-items: stretch;
					justify-content: center; gap: 4px;
					padding-left: 8px;
					border-left: 1px solid rgba(99,102,241,0.18);
					position: relative;
				}
				.side-top, .side-bottom { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
				.icon-btn {
					background: none; border: 0; padding: 4px; color: #a5b4fc;
					cursor: pointer; border-radius: 4px;
					font-size: 11px; font-variant-numeric: tabular-nums;
					display: inline-flex; align-items: center; gap: 3px;
				}
				.icon-btn:hover { color: #fff; background: rgba(99,102,241,0.15); }
				.icon-btn svg { width: 16px; height: 16px; display: block; }
				.dl, .speed, .share { text-decoration: none; }

				.vol-btn.is-muted { color: #f87171; }
				.vol-btn.is-muted .vol-on { display: none; }
				.vol-btn:not(.is-muted) .vol-off { display: none; }
				input[type="range"].vol {
					-webkit-appearance: none; appearance: none;
					width: 70px; height: 4px;
					border-radius: 4px;
					background: linear-gradient(to right,
						#a5b4fc var(--vol-pct, 85%),
						rgba(99,102,241,0.18) var(--vol-pct, 85%));
					outline: none; cursor: pointer;
				}
				input[type="range"].vol::-webkit-slider-thumb {
					-webkit-appearance: none; appearance: none;
					width: 12px; height: 12px; border-radius: 50%;
					background: #fff;
					box-shadow: 0 0 0 2px #6366f1, 0 2px 6px rgba(99,102,241,0.6);
					cursor: pointer;
				}
				input[type="range"].vol::-moz-range-thumb {
					width: 12px; height: 12px; border-radius: 50%;
					background: #fff; border: 0;
					box-shadow: 0 0 0 2px #6366f1, 0 2px 6px rgba(99,102,241,0.6);
					cursor: pointer;
				}

				/* Share menu */
				.share-menu {
					position: absolute;
					right: 0; top: calc(100% + 4px);
					min-width: 220px;
					background: #1e1b4b;
					border: 1px solid rgba(99,102,241,0.4);
					border-radius: 8px;
					padding: 4px;
					box-shadow: 0 12px 28px -8px rgba(0,0,0,0.5);
					display: none;
					z-index: 10;
				}
				.share-menu.open { display: block; }
				.share-menu button {
					display: block; width: 100%;
					padding: 7px 10px;
					background: none; border: 0;
					color: #e0e7ff;
					font-size: 12px; text-align: left;
					cursor: pointer; border-radius: 4px;
				}
				.share-menu button:hover { background: rgba(99,102,241,0.15); }
				.share-menu .hint { font-size: 10px; color: #94a3b8; padding: 4px 10px 6px; }

				/* Playlist controls — visible only when wrap.has-playlist */
				.pl-ctl { display: none; align-items: center; gap: 2px; }
				.wrap.has-playlist .pl-ctl { display: inline-flex; }
				.shuffle.is-on { color: #f0abfc; background: rgba(236,72,153,0.12); }

				/* Track list panel */
				.tracklist {
					position: absolute;
					right: 0; top: calc(100% + 4px);
					min-width: 260px;
					max-width: 360px;
					max-height: 280px;
					overflow-y: auto;
					background: #1e1b4b;
					border: 1px solid rgba(99,102,241,0.4);
					border-radius: 8px;
					padding: 4px;
					box-shadow: 0 12px 28px -8px rgba(0,0,0,0.5);
					display: none;
					z-index: 10;
				}
				.tracklist.open { display: block; }
				.tl-head { font-size: 10px; color: #94a3b8; padding: 6px 10px 4px; text-transform: uppercase; letter-spacing: 0.05em; }
				.tl-row {
					display: flex; align-items: center; gap: 8px;
					width: 100%;
					padding: 6px 10px;
					background: none; border: 0;
					color: #e0e7ff; text-align: left;
					font-size: 12px; cursor: pointer; border-radius: 4px;
				}
				.tl-row:hover { background: rgba(99,102,241,0.15); }
				.tl-row.is-active { color: #f0abfc; background: rgba(236,72,153,0.08); }
				.tl-row.is-active::before {
					content: '▶';
					margin-right: 2px;
				}
				.tl-num { color: #94a3b8; font-variant-numeric: tabular-nums; flex-shrink: 0; }
				.tl-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.tl-artist { color: #94a3b8; font-size: 11px; }

				/* Toast */
				.toast {
					position: absolute;
					top: 6px; right: 50%;
					transform: translateX(50%);
					padding: 4px 12px;
					background: rgba(34,197,94,0.18);
					border: 1px solid rgba(34,197,94,0.4);
					border-radius: 100px;
					color: #86efac;
					font-size: 11px;
					opacity: 0;
					pointer-events: none;
					transition: opacity 200ms ease;
				}
				.toast.show { opacity: 1; }

				@media (max-width: 560px) {
					.wrap { grid-template-columns: 48px 1fr; }
					.wrap.has-cover { grid-template-columns: 48px 64px 1fr; }
					.play { width: 48px; height: 48px; }
					.cover { width: 64px; height: 64px; }
					.side {
						grid-column: 1 / -1;
						flex-direction: row;
						justify-content: flex-end;
						border-left: 0;
						border-top: 1px solid rgba(99,102,241,0.18);
						padding-left: 0; padding-top: 8px;
					}
					.share-menu { right: 0; top: auto; bottom: 100%; margin-bottom: 4px; }
				}
			</style>

			<div class="wrap" part="wrap">
				<button class="play" type="button" aria-label="Lecture / Pause">
					<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
					<svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
				</button>

				<div class="cover-wrap">
					<img class="cover" alt="Pochette" />
				</div>

				<div class="main">
					<div class="meta" style="display: none;">
						<span class="title"></span>
						<span class="artist"></span>
					</div>
					<div class="eq"><canvas class="eq-canvas"></canvas></div>
					<div class="viz"><canvas class="wave-canvas"></canvas></div>
					<div class="controls">
						<span class="time"><span class="cur">0:00</span> / <span class="total">0:00</span></span>
					</div>
				</div>

				<div class="side">
					<div class="side-top">
						<span class="pl-ctl">
							<button class="icon-btn prev" type="button" title="Piste précédente" aria-label="Piste précédente">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg>
							</button>
							<button class="icon-btn next" type="button" title="Piste suivante" aria-label="Piste suivante">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z"/></svg>
							</button>
							<button class="icon-btn shuffle" type="button" title="Lecture aléatoire" aria-label="Lecture aléatoire" aria-pressed="false">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
							</button>
							<button class="icon-btn list" type="button" title="Liste des pistes" aria-label="Liste des pistes">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
							</button>
						</span>
						<a class="icon-btn dl" href="#" download style="display: none;" title="Télécharger" aria-label="Télécharger">
							<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>
						</a>
						<button class="icon-btn share" type="button" title="Partager" aria-label="Partager">
							<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
						</button>
						<button class="icon-btn speed" type="button" title="Vitesse de lecture" aria-label="Vitesse de lecture">1×</button>
					</div>
					<div class="side-bottom">
						<button class="icon-btn vol-btn" type="button" aria-label="Couper le son">
							<svg class="vol-on"  viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>
							<svg class="vol-off" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.18l2.45 2.45a4.5 4.5 0 0 0 .05-.6zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.96 8.96 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73L16.25 17.5c-.71.54-1.5.95-2.36 1.2L14 20.77a8.98 8.98 0 0 0 4.69-1.94L20.49 20.5 21.76 19.23 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
						</button>
						<input type="range" class="vol" min="0" max="100" value="85" step="1" aria-label="Volume" />
					</div>

					<div class="share-menu" role="menu">
						<button type="button" data-action="copy">Copier le lien</button>
						<button type="button" data-action="copy-at">Copier le lien à <span class="ts">0:00</span></button>
						<div class="hint">Le destinataire arrivera directement au bon endroit.</div>
					</div>
					<div class="tracklist" role="menu"></div>
				</div>

				<div class="toast" role="status" aria-live="polite">Lien copié</div>
			</div>
		`

		this._wrap      = this._shadow.querySelector('.wrap')!
		this._canvas    = this._shadow.querySelector('.wave-canvas')!
		this._eqCanvas  = this._shadow.querySelector('.eq-canvas')!
		this._eqCtx2d   = this._eqCanvas.getContext('2d')
		this._playBtn   = this._shadow.querySelector('.play')!
		this._coverImg  = this._shadow.querySelector('.cover')!
		this._titleEl   = this._shadow.querySelector('.title')!
		this._artistEl  = this._shadow.querySelector('.artist')!
		this._metaRow   = this._shadow.querySelector('.meta')!
		this._curEl     = this._shadow.querySelector('.cur')!
		this._totalEl   = this._shadow.querySelector('.total')!
		this._volEl     = this._shadow.querySelector('.vol')!
		this._volBtn    = this._shadow.querySelector('.vol-btn')!
		this._dlBtn     = this._shadow.querySelector('.dl')!
		this._speedBtn  = this._shadow.querySelector('.speed')!
		this._shareBtn  = this._shadow.querySelector('.share')!
		this._shareMenu = this._shadow.querySelector('.share-menu')!
		this._toast     = this._shadow.querySelector('.toast')!
		this._prevBtn   = this._shadow.querySelector('.prev')!
		this._nextBtn   = this._shadow.querySelector('.next')!
		this._shuffleBtn= this._shadow.querySelector('.shuffle')!
		this._listBtn   = this._shadow.querySelector('.list')!
		this._tracklistEl = this._shadow.querySelector('.tracklist')!
		this._ctx2d     = this._canvas.getContext('2d')
		this._setVolumeUI(this._lastVolume)
	}

	private _bindUI() {
		this._playBtn.addEventListener('click', () => this._toggle())
		this._coverImg.addEventListener('click', () => this._toggle())
		this._volBtn.addEventListener('click',  () => this._toggleMute())
		this._speedBtn.addEventListener('click', () => this._cycleSpeed())
		this._shareBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleShareMenu() })
		this._prevBtn.addEventListener('click',    () => this._prev())
		this._nextBtn.addEventListener('click',    () => this._next())
		this._shuffleBtn.addEventListener('click', () => this._toggleShuffle())
		this._listBtn.addEventListener('click',    (e) => { e.stopPropagation(); this._toggleTracklist() })

		this._shareMenu.addEventListener('click', (e) => {
			const target = e.target as HTMLElement
			const action = target.closest('[data-action]')?.getAttribute('data-action')
			if (action === 'copy')    this._share(false)
			if (action === 'copy-at') this._share(true)
		})

		// Close share menu + tracklist on outside click
		document.addEventListener('click', () => {
			this._closeShareMenu()
			this._closeTracklist()
		})

		// Waveform click → seek
		this._canvas.addEventListener('click', (e) => this._seekFromEvent(e))
		this._canvas.addEventListener('mousemove', (e) => {
			const rect = this._canvas.getBoundingClientRect()
			this._hoverPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
			this._drawWaveform()
		})
		this._canvas.addEventListener('mouseleave', () => { this._hoverPct = null; this._drawWaveform() })

		this._volEl.addEventListener('input', () => {
			const v = Number(this._volEl.value) / 100
			this._lastVolume = v
			this._audio.muted = false
			this._muted = v === 0
			this._audio.volume = v
			this._setVolumeUI(v)
			this._refreshMuteUI()
		})

		this._audio.addEventListener('play',  () => this._onPlay())
		this._audio.addEventListener('pause', () => this._onPause())
		this._audio.addEventListener('ended', () => {
			this._onPause()
			if (this._tracks.length > 1) this._next()
		})
		this._audio.addEventListener('timeupdate', () => this._onTimeUpdate())
		this._audio.addEventListener('loadedmetadata', () => {
			this._totalEl.textContent = fmtTime(this._audio.duration)
		})

		const ro = new ResizeObserver(() => this._sizeCanvases())
		ro.observe(this._canvas)
		ro.observe(this._eqCanvas)
		this._sizeCanvases()
	}

	private _sizeCanvases() {
		const dpr = Math.max(1, window.devicePixelRatio || 1)
		const fit = (c: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null) => {
			c.width  = Math.floor(c.clientWidth * dpr)
			c.height = Math.floor(c.clientHeight * dpr)
			ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
		}
		fit(this._canvas,   this._ctx2d)
		fit(this._eqCanvas, this._eqCtx2d)
		this._drawWaveform()
		this._drawEqIdle()
	}

	private _seekFromEvent(e: MouseEvent) {
		const rect = this._canvas.getBoundingClientRect()
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
		const dur = this._audio.duration || 0
		if (dur > 0) this._audio.currentTime = dur * pct
	}

	private async _toggle() {
		if (this._audio.paused) {
			try { await this._audio.play() } catch (e) { console.warn('[nodyx-audio] play failed', e) }
		} else {
			this._audio.pause()
		}
	}

	private _toggleMute() {
		this._muted = !this._muted
		this._audio.muted = this._muted
		this._setVolumeUI(this._muted ? 0 : this._lastVolume)
		this._refreshMuteUI()
	}

	private _cycleSpeed() {
		this._speedIdx = (this._speedIdx + 1) % SPEED_STEPS.length
		const v = SPEED_STEPS[this._speedIdx]
		this._audio.playbackRate = v
		this._speedBtn.textContent = (v === 1 ? '1' : v.toString()) + '×'
	}

	private _setVolumeUI(v: number) {
		const pct = Math.round(v * 100)
		this._volEl.value = String(pct)
		this._volEl.style.setProperty('--vol-pct', `${pct}%`)
	}

	private _refreshMuteUI() {
		this._volBtn.classList.toggle('is-muted', this._muted || this._audio.volume === 0)
		this._volBtn.setAttribute('aria-label', this._muted ? 'Activer le son' : 'Couper le son')
	}

	private _toggleShareMenu() {
		const open = this._shareMenu.classList.toggle('open')
		if (open) {
			const ts = this._shareMenu.querySelector('.ts')
			if (ts) ts.textContent = fmtTime(this._audio.currentTime || 0)
		}
	}

	private _closeShareMenu() {
		this._shareMenu.classList.remove('open')
	}

	private async _share(withTime: boolean) {
		const base = window.location.href.split('#')[0]
		const t = Math.floor(this._audio.currentTime || 0)
		const url = withTime && t > 0
			? `${base}#audio-${this._playerId}=t${t}`
			: `${base}#audio-${this._playerId}`
		try {
			await navigator.clipboard.writeText(url)
			this._showToast('Lien copié')
		} catch {
			// Fallback (no clipboard API): show the URL in toast so user can copy
			this._showToast('Copie impossible — ' + url.slice(0, 40) + '…')
		}
		this._closeShareMenu()
	}

	private _showToast(msg: string) {
		this._toast.textContent = msg
		this._toast.classList.add('show')
		setTimeout(() => this._toast.classList.remove('show'), 1800)
	}

	private async _onPlay() {
		this._playBtn.classList.add('is-playing')
		const ctx = getSharedCtx()
		if (ctx && ctx.state === 'suspended') {
			try { await ctx.resume() } catch {}
		}
		this._ensureGraph()
		this._startEq()
	}

	private _onPause() {
		this._playBtn.classList.remove('is-playing')
	}

	private _ensureGraph() {
		if (this._analyser) return
		const ctx = getSharedCtx()
		if (!ctx) return
		try {
			this._srcNode  = ctx.createMediaElementSource(this._audio)
			this._gainNode = ctx.createGain()
			this._analyser = ctx.createAnalyser()
			this._analyser.fftSize = 128
			this._analyser.smoothingTimeConstant = 0.78
			this._srcNode.connect(this._analyser)
			this._analyser.connect(this._gainNode)
			this._gainNode.connect(ctx.destination)
		} catch (e) {
			console.warn('[nodyx-audio] analyser init failed', e)
			this._analyser = null
		}
	}

	private _startEq() {
		if (this._eqRaf !== null) return
		const buf = new Uint8Array(this._analyser?.frequencyBinCount ?? EQ_BARS)
		const tick = () => {
			if (!this._eqCtx2d) { this._eqRaf = null; return }
			if (this._analyser) this._analyser.getByteFrequencyData(buf)
			else                buf.fill(0)
			this._drawEqBars(buf)
			const energy = this._eqBars.reduce((a, b) => a + b, 0) + this._eqPeaks.reduce((a, b) => a + b, 0)
			if (this._audio.paused && energy < 0.6) {
				this._eqRaf = null
				this._drawEqIdle()
				return
			}
			this._eqRaf = requestAnimationFrame(tick)
		}
		this._eqRaf = requestAnimationFrame(tick)
	}

	private _drawEqBars(buf: Uint8Array) {
		const ctx = this._eqCtx2d!
		const w   = this._eqCanvas.clientWidth
		const h   = this._eqCanvas.clientHeight
		ctx.clearRect(0, 0, w, h)

		const gap  = 2
		const barW = Math.max(2, (w - (EQ_BARS - 1) * gap) / EQ_BARS)
		const bins = buf.length

		for (let i = 0; i < EQ_BARS; i++) {
			// Log-distribute FFT bins (low → low end, high → high end)
			const lo = Math.floor((i       / EQ_BARS) ** 1.6 * bins)
			const hi = Math.max(lo + 1, Math.floor(((i + 1) / EQ_BARS) ** 1.6 * bins))
			let sum = 0, n = 0
			for (let j = lo; j < hi && j < bins; j++) { sum += buf[j]; n++ }
			const v = n > 0 ? sum / n / 255 : 0

			const prev = this._eqBars[i]
			this._eqBars[i] = v > prev ? v : prev * 0.86 + v * 0.14
			if (this._eqBars[i] > this._eqPeaks[i]) this._eqPeaks[i] = this._eqBars[i]
			else this._eqPeaks[i] = Math.max(0, this._eqPeaks[i] - 0.012)
		}

		const grad = ctx.createLinearGradient(0, h, 0, 0)
		grad.addColorStop(0,    '#6366f1')
		grad.addColorStop(0.55, '#a855f7')
		grad.addColorStop(1,    '#ec4899')

		ctx.fillStyle = grad
		for (let i = 0; i < EQ_BARS; i++) {
			const x  = i * (barW + gap)
			const bh = Math.max(2, this._eqBars[i] * (h - 4))
			ctx.fillRect(x, h - bh, barW, bh)
			const py = h - Math.max(2, this._eqPeaks[i] * (h - 4)) - 2
			ctx.fillStyle = 'rgba(255,255,255,0.7)'
			ctx.fillRect(x, py, barW, 2)
			ctx.fillStyle = grad
		}
	}

	private _drawEqIdle() {
		const ctx = this._eqCtx2d
		if (!ctx) return
		const w = this._eqCanvas.clientWidth
		const h = this._eqCanvas.clientHeight
		ctx.clearRect(0, 0, w, h)
		const gap  = 2
		const barW = Math.max(2, (w - (EQ_BARS - 1) * gap) / EQ_BARS)
		ctx.fillStyle = 'rgba(99,102,241,0.22)'
		for (let i = 0; i < EQ_BARS; i++) {
			const x  = i * (barW + gap)
			const bh = 3 + ((i * 5) % 7)
			ctx.fillRect(x, h - bh, barW, bh)
		}
	}

	private _onTimeUpdate() {
		const cur = this._audio.currentTime || 0
		this._curEl.textContent = fmtTime(cur)
		this._drawWaveform()
	}

	private _drawWaveform() {
		const ctx = this._ctx2d
		if (!ctx) return
		const w = this._canvas.clientWidth
		const h = this._canvas.clientHeight
		ctx.clearRect(0, 0, w, h)

		const peaks = this._peaks || this._idle
		const dur   = this._audio.duration || 0
		const cur   = this._audio.currentTime || 0
		const progressPct = dur > 0 ? cur / dur : 0
		const hoverPx     = this._hoverPct !== null ? this._hoverPct * w : -1

		const gap   = 1
		const total = peaks.length
		const barW  = Math.max(1.5, (w - (total - 1) * gap) / total)

		// Gradient (played)
		const grad = ctx.createLinearGradient(0, h, 0, 0)
		grad.addColorStop(0,    '#6366f1')
		grad.addColorStop(0.55, '#a855f7')
		grad.addColorStop(1,    '#ec4899')

		const midY = h / 2
		for (let i = 0; i < total; i++) {
			const x  = i * (barW + gap)
			const bh = Math.max(2, peaks[i] * (h - 4))
			const y  = midY - bh / 2

			const barCenterPct = (x + barW / 2) / w
			const isHover = hoverPx >= 0 && Math.abs(x + barW / 2 - hoverPx) < 12

			if (barCenterPct <= progressPct) {
				ctx.fillStyle = grad
			} else if (isHover) {
				ctx.fillStyle = 'rgba(165,180,252,0.45)'
			} else {
				ctx.fillStyle = 'rgba(99,102,241,0.32)'
			}
			ctx.fillRect(x, y, barW, bh)
		}

		// Hover line
		if (hoverPx >= 0) {
			ctx.fillStyle = 'rgba(255,255,255,0.35)'
			ctx.fillRect(Math.max(0, hoverPx - 0.5), 0, 1, h)
		}
	}
}

export function defineNodyxAudioPlayer() {
	if (typeof window === 'undefined') return
	if (!customElements.get(TAG)) customElements.define(TAG, NodyxAudioPlayer)
}
