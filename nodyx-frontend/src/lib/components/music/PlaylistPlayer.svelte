<script module lang="ts">
	// Classification large et verifiable (genre principal du groupe / du titre,
	// pas une etiquette marketing) : sert uniquement a suggerer "plus dans le
	// meme genre" dans le panneau, jamais affichee comme une verite absolue.
	export type Genre = 'post_grunge' | 'pop_punk' | 'alt_rock' | 'nu_metal' | 'alt_metal' | 'metalcore' | 'post_hardcore';

	export interface Track {
		n:       number;
		artist:  string;
		title:   string;
		yt:      string;
		unknown?: boolean;
		genre?:  Genre;
		description?: string;
	}

	export interface CustomSection {
		id: string;
		label: string;
		trackYts: string[];
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	const tFn = $derived($t);

	const DEFAULT_GENRE_LABEL: Record<Genre, string> = {
		post_grunge:   'music.playlist.genre.post_grunge',
		pop_punk:      'music.playlist.genre.pop_punk',
		alt_rock:      'music.playlist.genre.alt_rock',
		nu_metal:      'music.playlist.genre.nu_metal',
		alt_metal:     'music.playlist.genre.alt_metal',
		metalcore:     'music.playlist.genre.metalcore',
		post_hardcore: 'music.playlist.genre.post_hardcore',
	};
	const otherGenres: Genre[] = ['pop_punk', 'metalcore', 'post_hardcore'];

	let {
		tracks,
		customSections = [],
		eyebrow,
		pageTitle,
		heroThumbYt,
		backHref,
		storageKey,
		genreLabels,
	}: {
		tracks: Track[];
		customSections?: CustomSection[];
		eyebrow: string;
		pageTitle: string;
		heroThumbYt?: string;
		backHref: string;
		storageKey: string;
		genreLabels?: Partial<Record<Genre, string>>;
	} = $props();

	const genreLabel = $derived({ ...DEFAULT_GENRE_LABEL, ...genreLabels } as Record<Genre, string>);
	const total = $derived(tracks.length);
	const heroThumb = $derived(heroThumbYt ?? tracks[0]?.yt);

	// Cles localStorage namespacees par playlist (`storageKey`) : plusieurs
	// playlists sur la meme instance ne doivent jamais partager favoris,
	// historique ou preferences (chaque playlist a son propre stockage).
	const K_FAV   = $derived(`nodyx-playlist-${storageKey}-favorites`);
	const K_RECENT = $derived(`nodyx-playlist-${storageKey}-recent`);
	const K_PREFS  = $derived(`nodyx-playlist-${storageKey}-prefs`);

	type TabId = 'favorites' | 'recent' | Genre | 'other' | string;

	let favorites = $state<Set<string>>(new Set());
	let recentIds = $state<string[]>([]);

	function toggleFavorite(yt: string, e?: MouseEvent) {
		e?.stopPropagation();
		const next = new Set(favorites);
		if (next.has(yt)) next.delete(yt); else next.add(yt);
		favorites = next;
		try { localStorage.setItem(K_FAV, JSON.stringify([...next])); } catch { /* stockage indisponible, tant pis */ }
	}

	function pushRecent(track: Track) {
		if (track.unknown) return;
		recentIds = [track.yt, ...recentIds.filter((id) => id !== track.yt)].slice(0, 10);
		try { localStorage.setItem(K_RECENT, JSON.stringify(recentIds)); } catch { /* stockage indisponible, tant pis */ }
	}

	const recentTracks = $derived(
		recentIds.map((id) => tracks.find((t) => t.yt === id)).filter((t): t is Track => !!t),
	);

	interface Tab { id: TabId; label: string; tracks: Track[]; }
	const tabs = $derived<Tab[]>([
		...customSections.map((s) => ({
			id: s.id,
			label: s.label,
			tracks: s.trackYts.map((yt) => tracks.find((t) => t.yt === yt)).filter((t): t is Track => !!t),
		})),
		{ id: 'favorites',   label: tFn('music.playlist.tab_favorites'), tracks: tracks.filter((t) => favorites.has(t.yt)) },
		{ id: 'recent',      label: tFn('music.playlist.tab_recent'),    tracks: recentTracks },
		{ id: 'post_grunge', label: tFn(genreLabel.post_grunge),         tracks: tracks.filter((t) => t.genre === 'post_grunge') },
		{ id: 'nu_metal',    label: tFn(genreLabel.nu_metal),            tracks: tracks.filter((t) => t.genre === 'nu_metal') },
		{ id: 'alt_metal',   label: tFn(genreLabel.alt_metal),           tracks: tracks.filter((t) => t.genre === 'alt_metal') },
		{ id: 'alt_rock',    label: tFn(genreLabel.alt_rock),            tracks: tracks.filter((t) => t.genre === 'alt_rock') },
		{ id: 'other',       label: tFn('music.playlist.tab_other'),     tracks: tracks.filter((t) => otherGenres.includes(t.genre as Genre)) },
	].filter((tab) => customSections.some((s) => s.id === tab.id) || tab.tracks.length > 0 || tab.id === 'favorites' || tab.id === 'recent'));

	let activeTabId = $state<TabId>(customSections[0]?.id ?? 'favorites');
	// Une recherche tapee dans une playlist qui resterait active en changeant de
	// playlist ferait croire que des titres ont disparu sans raison : on la vide
	// a chaque changement (retour Jonathan, 19/09).
	function selectTab(id: TabId) {
		activeTabId = id;
		filterQuery = '';
	}
	const activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? tabs[0]);

	let filterQuery = $state('');
	function matchesFilter(t: Track): boolean {
		if (!filterQuery.trim()) return true;
		if (t.unknown) return false;
		const q = filterQuery.toLowerCase();
		return t.artist.toLowerCase().includes(q) || t.title.toLowerCase().includes(q);
	}
	const activeList = $derived(activeTab ? activeTab.tracks.filter(matchesFilter) : []);

	let nowPlaying = $state<Track | null>(null);
	let history: Track[] = $state([]);
	let shuffle = $state(false);
	let volume = $state(80);
	let repeat = $state<'off' | 'all' | 'one'>('off');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	// File d'attente : capturee au moment ou on lance une lecture depuis un
	// onglet donne, pas recalculee en continu depuis l'onglet regarde. Sinon
	// naviguer dans la liste pendant une lecture changerait la piste suivante
	// sans le vouloir. Le mode aleatoire tire un ordre fige une fois (pas un
	// tirage a chaque "suivant"), pour ne pas repasser deux fois sur le meme
	// titre avant d'avoir fait le tour.
	let queueSource = $state<Track[]>(tracks);
	let shuffledOrder = $state<Track[]>([]);

	function fisherYates(arr: Track[]): Track[] {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	}
	function reshuffle() {
		shuffledOrder = fisherYates(queueSource.filter((t) => t.yt !== nowPlaying?.yt));
	}
	function savePrefs() {
		try { localStorage.setItem(K_PREFS, JSON.stringify({ volume, shuffle, repeat })); } catch { /* stockage indisponible, tant pis */ }
	}

	function toggleShuffle() {
		shuffle = !shuffle;
		if (shuffle) reshuffle();
		savePrefs();
	}

	function play(track: Track, source?: Track[]) {
		if (nowPlaying && nowPlaying.yt !== track.yt) history.push(nowPlaying);
		if (source) {
			queueSource = source;
			if (shuffle) reshuffle();
		} else if (shuffle) {
			const idx = shuffledOrder.findIndex((t) => t.yt === track.yt);
			if (idx >= 0) shuffledOrder = shuffledOrder.slice(idx + 1);
		}
		nowPlaying = track;
		pushRecent(track);
	}

	const currentIndex = $derived(nowPlaying ? queueSource.findIndex((t) => t.yt === nowPlaying!.yt) : -1);
	const hasPrev = $derived(history.length > 0);
	const hasNext = $derived(
		shuffle
			? shuffledOrder.length > 0 || (repeat === 'all' && queueSource.length > 1)
			: (currentIndex >= 0 && currentIndex < queueSource.length - 1) || (repeat === 'all' && queueSource.length > 1),
	);

	const upNext = $derived.by(() => {
		if (!nowPlaying) return [] as Track[];
		if (shuffle) return shuffledOrder.slice(0, 5);
		if (currentIndex < 0) return [] as Track[];
		const rest = queueSource.slice(currentIndex + 1);
		if (rest.length > 0) return rest.slice(0, 5);
		return repeat === 'all' ? queueSource.filter((t) => t.yt !== nowPlaying!.yt).slice(0, 5) : [];
	});

	function playPrev() {
		const prev = history.pop();
		if (prev) nowPlaying = prev;
	}
	function playNext() {
		if (!nowPlaying || !hasNext) return;
		if (shuffle) {
			if (shuffledOrder.length === 0) reshuffle();
			const next = shuffledOrder[0];
			shuffledOrder = shuffledOrder.slice(1);
			if (next) play(next);
			return;
		}
		const next = currentIndex < queueSource.length - 1 ? queueSource[currentIndex + 1] : queueSource[0];
		play(next);
	}

	function cycleRepeat() {
		repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
		savePrefs();
	}

	function handleEnded() {
		if (repeat === 'one') {
			player?.seekTo?.(0, true);
			player?.playVideo?.();
			return;
		}
		playNext();
	}

	function togglePlay() {
		if (!player) return;
		if (isPlaying) player.pauseVideo();
		else player.playVideo();
	}

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	let progressTimer: ReturnType<typeof setInterval> | null = null;
	function startProgressPolling() {
		if (progressTimer) return;
		progressTimer = setInterval(() => {
			if (!player?.getCurrentTime) return;
			currentTime = player.getCurrentTime();
			duration = player.getDuration() || 0;
		}, 500);
	}
	function stopProgressPolling() {
		if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
	}

	function seek(e: MouseEvent) {
		if (!player?.seekTo || !duration) return;
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		player.seekTo(ratio * duration, true);
		currentTime = ratio * duration;
	}

	// stopPropagation : la barre focus les fleches pour avancer/reculer de 5s,
	// le raccourci clavier global (fenetre entiere) les utilise pour changer de
	// piste. Sans ca, les deux se declenchent en meme temps sur la meme touche.
	function onProgressKey(e: KeyboardEvent) {
		if (!player?.seekTo || !duration) return;
		if (e.key === 'ArrowRight') {
			e.preventDefault(); e.stopPropagation();
			currentTime = Math.min(duration, currentTime + 5);
			player.seekTo(currentTime, true);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault(); e.stopPropagation();
			currentTime = Math.max(0, currentTime - 5);
			player.seekTo(currentTime, true);
		}
	}

	// Suggestions "plus dans le meme genre" : catalogue fige, jamais de titre
	// invente hors des pistes fournies par l'appelant.
	const suggestions = $derived(
		nowPlaying?.genre
			? tracks.filter((t) => t.genre === nowPlaying!.genre && t.yt !== nowPlaying!.yt).slice(0, 4)
			: [],
	);

	// Lecteur pilote par l'API IFrame YouTube (pas un simple src d'iframe) : seul
	// moyen d'exposer volume, avance automatique en fin de piste et un lecteur
	// unique qui charge la piste suivante au lieu de recreer l'iframe a chaque
	// clic. Domaine nocookie conserve via l'option `host`.
	let playerHost = $state<HTMLDivElement>();
	let player: any = null;
	let apiReady = $state(false);

	onMount(() => {
		try {
			const rawFav = localStorage.getItem(K_FAV);
			if (rawFav) favorites = new Set(JSON.parse(rawFav));
			const rawRecent = localStorage.getItem(K_RECENT);
			if (rawRecent) recentIds = JSON.parse(rawRecent);
			const rawPrefs = localStorage.getItem(K_PREFS);
			if (rawPrefs) {
				const prefs = JSON.parse(rawPrefs);
				if (typeof prefs.volume === 'number') volume = prefs.volume;
				if (typeof prefs.shuffle === 'boolean') shuffle = prefs.shuffle;
				if (prefs.repeat === 'off' || prefs.repeat === 'all' || prefs.repeat === 'one') repeat = prefs.repeat;
			}
		} catch { /* stockage indisponible, tant pis */ }

		// Controles depuis l'ecran verrouille, un casque Bluetooth ou les touches
		// multimedia du clavier : rien a construire, l'API du navigateur s'en
		// charge des qu'on lui donne les metadonnees et les actions.
		if ('mediaSession' in navigator) {
			navigator.mediaSession.setActionHandler('play', () => player?.playVideo?.());
			navigator.mediaSession.setActionHandler('pause', () => player?.pauseVideo?.());
			navigator.mediaSession.setActionHandler('previoustrack', () => { if (hasPrev) playPrev(); });
			navigator.mediaSession.setActionHandler('nexttrack', () => { if (hasNext) playNext(); });
		}

		const w = window as any;
		if (w.YT && w.YT.Player) {
			apiReady = true;
		} else {
			const prevCallback = w.onYouTubeIframeAPIReady;
			w.onYouTubeIframeAPIReady = () => {
				prevCallback?.();
				apiReady = true;
			};
			if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
				const tag = document.createElement('script');
				tag.src = 'https://www.youtube.com/iframe_api';
				document.head.appendChild(tag);
			}
		}

		// Raccourcis clavier type lecteur de bureau : ignores si un champ texte
		// (recherche, volume) a le focus, pour ne pas voler la saisie ou la barre
		// d'espace du navigateur.
		function handleKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
			if (!nowPlaying) return;
			if (e.key === ' ') { e.preventDefault(); togglePlay(); }
			else if (e.key === 'ArrowRight') { if (hasNext) playNext(); }
			else if (e.key === 'ArrowLeft') { if (hasPrev) playPrev(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); volume = Math.min(100, volume + 5); onVolumeInput(); }
			else if (e.key === 'ArrowDown') { e.preventDefault(); volume = Math.max(0, volume - 5); onVolumeInput(); }
		}
		window.addEventListener('keydown', handleKey);
		window.addEventListener('scroll', updatePanelFixed, { passive: true });
		window.addEventListener('resize', updatePanelFixed);
		updatePanelFixed();
		return () => {
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('scroll', updatePanelFixed);
			window.removeEventListener('resize', updatePanelFixed);
			if ('mediaSession' in navigator) {
				navigator.mediaSession.setActionHandler('play', null);
				navigator.mediaSession.setActionHandler('pause', null);
				navigator.mediaSession.setActionHandler('previoustrack', null);
				navigator.mediaSession.setActionHandler('nexttrack', null);
			}
		};
	});

	$effect(() => {
		if (!apiReady || !nowPlaying || !playerHost) return;
		const w = window as any;
		if (!player) {
			player = new w.YT.Player(playerHost, {
				videoId: nowPlaying.yt,
				host: 'https://www.youtube-nocookie.com',
				width: '100%',
				height: '100%',
				playerVars: { autoplay: 1, playsinline: 1 },
				events: {
					onReady: (e: any) => e.target.setVolume(volume),
					onStateChange: (e: any) => {
						isPlaying = e.data === w.YT.PlayerState.PLAYING;
						if (isPlaying) startProgressPolling();
						else stopProgressPolling();
						if (e.data === w.YT.PlayerState.ENDED) handleEnded();
					},
				},
			});
		} else if (typeof player.loadVideoById === 'function') {
			currentTime = 0;
			duration = 0;
			player.loadVideoById(nowPlaying.yt);
		}
	});

	// Fait defiler la liste pour garder la piste active visible, y compris quand
	// le changement vient du clavier, de suivant/precedent ou d'une suggestion
	// (pas seulement d'un clic direct dans la liste visible).
	let listRoot = $state<HTMLDivElement>();
	$effect(() => {
		if (!nowPlaying || !listRoot) return;
		listRoot.querySelector('.pl-row--active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	// `position: sticky` ne suffit pas ici : le <main> de l'appli porte bien
	// overflow-y:auto, mais sur cette page il grandit avec son contenu au lieu
	// de scroller lui-meme, donc c'est la fenetre qui scrolle. Sticky reste
	// ancre a un <main> qui ne bouge jamais de son point de vue et decroche
	// (retour Jonathan, 19/09 : "la zone de droite doit rester en haut").
	// Parade : on mesure la position naturelle du panneau et on bascule en
	// position fixed nous-memes une fois qu'elle passerait sous top:24px.
	let panelSlot = $state<HTMLDivElement>();
	let panelFixed = $state(false);
	let panelLeft = $state(0);
	let panelWidth = $state(0);

	function updatePanelFixed() {
		if (!panelSlot || window.innerWidth <= 900) { panelFixed = false; return; }
		const rect = panelSlot.getBoundingClientRect();
		panelLeft = rect.left;
		panelWidth = rect.width;
		panelFixed = rect.top <= 24;
	}
	$effect(() => {
		if (nowPlaying) updatePanelFixed();
	});

	$effect(() => {
		if (!nowPlaying || !('mediaSession' in navigator)) return;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: nowPlaying.unknown ? tFn('music.playlist.unknown_track') : nowPlaying.title,
			artist: nowPlaying.unknown ? '' : nowPlaying.artist,
			album: 'Nodyx',
			artwork: [{ src: `https://img.youtube.com/vi/${nowPlaying.yt}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }],
		});
	});
	$effect(() => {
		if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
	});

	function onVolumeInput() {
		player?.setVolume?.(volume);
		savePrefs();
	}

	let previousVolume = 80;
	function toggleMute() {
		if (volume > 0) {
			previousVolume = volume;
			volume = 0;
		} else {
			volume = previousVolume || 80;
		}
		onVolumeInput();
	}
</script>

<div class="pl-page">
	<a href={backHref} class="pl-back">← {tFn('music.playlist.back')}</a>

	<div class="pl-layout">
		<div class="pl-main" bind:this={listRoot}>
			<header class="pl-hero">
				{#if heroThumb}
					<div class="pl-hero-art">
						<img src={`https://img.youtube.com/vi/${heroThumb}/hqdefault.jpg`} alt="" loading="lazy" />
					</div>
				{/if}
				<div class="pl-hero-info">
					<p class="pl-hero-kicker">{eyebrow}</p>
					<h1 class="pl-hero-title">{pageTitle}</h1>
					<p class="pl-hero-meta">{tFn('music.playlist.track_count').replace('{{n}}', String(total))}</p>
				</div>
			</header>

			<div class="pl-tab-select">
				<label for="pl-playlist-select-{storageKey}" class="pl-tab-select-label">{tFn('music.playlist.choose_playlist')}</label>
				<div class="pl-tab-select-control">
					<select id="pl-playlist-select-{storageKey}" value={activeTabId} onchange={(e) => selectTab((e.currentTarget as HTMLSelectElement).value)}>
						{#each tabs as tab (tab.id)}
							<option value={tab.id}>{tab.label} ({tab.tracks.length})</option>
						{/each}
					</select>
					<svg class="pl-tab-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
				</div>
			</div>

			<div class="pl-search">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
				<input type="text" bind:value={filterQuery} placeholder={tFn('music.playlist.search_placeholder')} aria-label={tFn('music.playlist.search_placeholder')} />
			</div>

			<section class="pl-section">
				<h2 class="pl-section-title">{activeTab?.label}</h2>
				{#if activeList.length === 0}
					<p class="pl-empty-tab">
						{#if filterQuery.trim()}{tFn('music.playlist.empty_search')}
						{:else if activeTabId === 'favorites'}{tFn('music.playlist.empty_favorites')}
						{:else if activeTabId === 'recent'}{tFn('music.playlist.empty_recent')}
						{:else}{tFn('music.playlist.empty_search')}{/if}
					</p>
				{:else}
					<ol class="pl-list">
						{#each activeList as track (track.yt)}
							<li class="pl-row" class:pl-row--active={nowPlaying?.yt === track.yt}>
								<button type="button" class="pl-row-btn" onclick={() => play(track, activeTab.tracks)}
								        aria-label={track.unknown ? tFn('music.playlist.unknown_track') : `${track.artist} - ${track.title}`}>
									<span class="pl-row-n">{track.n}</span>
									<span class="pl-row-thumb">
										<img src={`https://img.youtube.com/vi/${track.yt}/default.jpg`} alt="" loading="lazy" />
										<svg class="pl-row-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
									</span>
									<span class="pl-row-text">
										{#if track.unknown}
											<span class="pl-row-title pl-row-title--unknown">{tFn('music.playlist.unknown_track')}</span>
										{:else}
											<span class="pl-row-artist">{track.artist}</span>
											<span class="pl-row-title">{track.title}</span>
										{/if}
									</span>
								</button>
								{#if !track.unknown}
									<button type="button" class="pl-row-fav" class:active={favorites.has(track.yt)}
									        onclick={(e) => toggleFavorite(track.yt, e)} aria-pressed={favorites.has(track.yt)}
									        aria-label={tFn('music.playlist.favorite')}>
										<svg viewBox="0 0 24 24" fill={favorites.has(track.yt) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
											<path d="M12 21s-6.7-4.35-9.3-8.05C1.02 10.7 1.6 7.5 4.2 6.1 6.2 5 8.7 5.6 10 7.3l2 2.6 2-2.6c1.3-1.7 3.8-2.3 5.8-1.2 2.6 1.4 3.18 4.6 1.5 6.85C18.7 16.65 12 21 12 21z"/>
										</svg>
									</button>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		</div>

		<div class="pl-panel-slot" bind:this={panelSlot}>
		<aside class="pl-panel" class:pl-panel--empty={!nowPlaying} class:pl-panel--fixed={panelFixed}
		       style:left={panelFixed ? `${panelLeft}px` : null} style:width={panelFixed ? `${panelWidth}px` : null}>
			{#if nowPlaying}
				<div class="pl-panel-frame">
					<div bind:this={playerHost}></div>
				</div>
				<div class="pl-panel-body">
					<div class="pl-panel-title-row">
						<div>
							<p class="pl-panel-label">{tFn('music.playlist.now_playing')} · {currentIndex + 1}/{queueSource.length}</p>
							{#if nowPlaying.unknown}
								<p class="pl-panel-title">{tFn('music.playlist.unknown_track')}</p>
							{:else}
								<p class="pl-panel-artist">{nowPlaying.artist}</p>
								<p class="pl-panel-title">{nowPlaying.title}</p>
							{/if}
						</div>
						{#if !nowPlaying.unknown}
							<button type="button" class="pl-panel-fav" class:active={favorites.has(nowPlaying.yt)}
							        onclick={(e) => toggleFavorite(nowPlaying!.yt, e)} aria-pressed={favorites.has(nowPlaying.yt)}
							        aria-label={tFn('music.playlist.favorite')}>
								<svg viewBox="0 0 24 24" fill={favorites.has(nowPlaying.yt) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
									<path d="M12 21s-6.7-4.35-9.3-8.05C1.02 10.7 1.6 7.5 4.2 6.1 6.2 5 8.7 5.6 10 7.3l2 2.6 2-2.6c1.3-1.7 3.8-2.3 5.8-1.2 2.6 1.4 3.18 4.6 1.5 6.85C18.7 16.65 12 21 12 21z"/>
								</svg>
							</button>
						{/if}
					</div>

					<div class="pl-progress-row">
						<span class="pl-progress-time">{formatTime(currentTime)}</span>
						<div class="pl-progress" onclick={seek} onkeydown={onProgressKey} role="slider" aria-label={tFn('music.playlist.seek')} aria-valuemin="0" aria-valuemax={duration} aria-valuenow={currentTime} tabindex="0">
							<div class="pl-progress-fill" style:width="{duration ? (currentTime / duration) * 100 : 0}%"></div>
						</div>
						<span class="pl-progress-time">{formatTime(duration)}</span>
					</div>

					<div class="pl-panel-controls">
						<button type="button" class="pl-ctrl-shuffle" class:active={shuffle} onclick={toggleShuffle} aria-pressed={shuffle} aria-label={tFn('music.playlist.shuffle')}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="16 3 21 3 21 8"></polyline>
								<line x1="4" y1="20" x2="21" y2="3"></line>
								<polyline points="21 16 21 21 16 21"></polyline>
								<line x1="15" y1="15" x2="21" y2="21"></line>
								<line x1="4" y1="4" x2="9" y2="9"></line>
							</svg>
						</button>
						<button type="button" onclick={playPrev} disabled={!hasPrev} aria-label={tFn('music.playlist.prev')}>
							<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
						</button>
						<button type="button" class="pl-ctrl-play" onclick={togglePlay} aria-label={tFn(isPlaying ? 'music.playlist.pause' : 'music.playlist.play')}>
							{#if isPlaying}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
							{:else}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
							{/if}
						</button>
						<button type="button" onclick={playNext} disabled={!hasNext} aria-label={tFn('music.playlist.next')}>
							<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
						</button>
						<button type="button" class="pl-ctrl-repeat" class:active={repeat !== 'off'} onclick={cycleRepeat} aria-label={tFn('music.playlist.repeat')}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="17 1 21 5 17 9"></polyline>
								<path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
								<polyline points="7 23 3 19 7 15"></polyline>
								<path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
							</svg>
							{#if repeat === 'one'}<span class="pl-ctrl-repeat-one">1</span>{/if}
						</button>
					</div>

					<div class="pl-panel-volume">
						<button type="button" class="pl-volume-icon" onclick={toggleMute} aria-label={tFn(volume === 0 ? 'music.playlist.unmute' : 'music.playlist.mute')}>
							{#if volume === 0}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="m19 9-4.5 6M14.5 9 19 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
							{:else if volume < 50}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
							{:else}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.74 2.5-2.26 2.5-4.02z"/></svg>
							{/if}
						</button>
						<input type="range" min="0" max="100" bind:value={volume} oninput={onVolumeInput} aria-label={tFn('music.playlist.volume')}
						       style:background={`linear-gradient(to right, rgba(139,92,246,.9) ${volume}%, rgba(255,255,255,.12) ${volume}%)`} />
						<span class="pl-volume-pct">{volume}%</span>
					</div>

					{#if !nowPlaying.unknown && nowPlaying.description}
						<p class="pl-panel-bio">{nowPlaying.description}</p>
					{/if}
					{#if nowPlaying.genre}
						<span class="pl-panel-genre">{tFn(genreLabel[nowPlaying.genre])}</span>
					{/if}

					{#if upNext.length > 0}
						<div class="pl-panel-more">
							<p class="pl-panel-more-label">{tFn('music.playlist.queue_label')}</p>
							<ul class="pl-more-list">
								{#each upNext as q (q.yt)}
									<li>
										<button type="button" class="pl-more-btn" onclick={() => play(q)}>
											<img src={`https://img.youtube.com/vi/${q.yt}/default.jpg`} alt="" loading="lazy" />
											<span class="pl-more-text">
												<span class="pl-more-artist">{q.artist}</span>
												<span class="pl-more-title">{q.title}</span>
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if suggestions.length > 0}
						<div class="pl-panel-more">
							<p class="pl-panel-more-label">{tFn('music.playlist.more_like_this')}</p>
							<ul class="pl-more-list">
								{#each suggestions as s (s.yt)}
									<li>
										<button type="button" class="pl-more-btn" onclick={() => play(s, tracks.filter((t) => t.genre === nowPlaying?.genre))}>
											<img src={`https://img.youtube.com/vi/${s.yt}/default.jpg`} alt="" loading="lazy" />
											<span class="pl-more-text">
												<span class="pl-more-artist">{s.artist}</span>
												<span class="pl-more-title">{s.title}</span>
											</span>
										</button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{:else}
				<div class="pl-panel-empty">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 5v14l11-7z"/></svg>
					<p>{tFn('music.playlist.pick_track')}</p>
				</div>
			{/if}
		</aside>
		</div>
	</div>

	{#if nowPlaying}
		<button type="button" class="pl-mini" onclick={() => document.querySelector('.pl-panel')?.scrollIntoView({ behavior: 'smooth' })}>
			<img src={`https://img.youtube.com/vi/${nowPlaying.yt}/default.jpg`} alt="" />
			<span class="pl-mini-text">
				{#if nowPlaying.unknown}
					<span class="pl-mini-title">{tFn('music.playlist.unknown_track')}</span>
				{:else}
					<span class="pl-mini-artist">{nowPlaying.artist}</span>
					<span class="pl-mini-title">{nowPlaying.title}</span>
				{/if}
			</span>
			<span class="pl-mini-play" onclick={(e) => { e.stopPropagation(); togglePlay(); }} role="button" tabindex="0"
			      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); togglePlay(); } }}
			      aria-label={tFn(isPlaying ? 'music.playlist.pause' : 'music.playlist.play')}>
				{#if isPlaying}
					<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
				{/if}
			</span>
			<span class="pl-mini-progress" style:width="{duration ? (currentTime / duration) * 100 : 0}%"></span>
		</button>
	{/if}
</div>

<style>
	.pl-page {
		width: 100%;
		padding: 24px 28px 48px;
		color: #fff;
	}
	.pl-back {
		display: inline-block;
		font-size: 0.8125rem;
		color: rgba(255,255,255,.5);
		text-decoration: none;
		margin-bottom: 20px;
		transition: color .15s;
	}
	.pl-back:hover { color: #fff; }

	/* ── Deux colonnes pleine largeur : liste a gauche, lecteur colle a droite,
	   sur toute la largeur laissee par les sidebars de l'appli, pas une colonne
	   centree qui gaspille l'espace (retour direct de Jonathan, 19/09). ── */
	.pl-layout {
		display: grid;
		grid-template-columns: 1fr 420px;
		gap: 32px;
		align-items: start;
	}
	.pl-main { min-width: 0; }

	.pl-panel-slot { min-width: 0; }

	.pl-panel {
		background: rgba(255,255,255,.03);
		border: 1px solid rgba(255,255,255,.06);
	}
	/* position:fixed pilotee en JS (voir updatePanelFixed) : sticky ne marche
	   pas sur cette page, cf commentaire dans le script. */
	.pl-panel--fixed {
		position: fixed;
		top: 24px;
		z-index: 30;
		max-height: calc(100dvh - 48px);
		overflow-y: auto;
	}
	.pl-panel-frame { aspect-ratio: 16 / 9; background: #000; }
	/* :global() car cet iframe est injecte a l'execution par l'API YouTube, pas
	   ecrit dans ce template : sans ca, Svelte elague la regle comme "inutilisee". */
	.pl-panel-frame :global(iframe) { width: 100%; height: 100%; border: none; display: block; }
	.pl-panel-body { padding: 16px; }
	.pl-panel-genre {
		display: inline-block; margin-top: 10px; padding: 3px 9px; font-size: 0.6875rem; font-weight: 600;
		border-radius: 999px; background: rgba(139, 92, 246, 0.12); color: rgba(139, 92, 246, 0.9);
	}
	.pl-panel-label {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
		color: rgba(139, 92, 246, 0.85); margin: 0 0 6px;
	}
	.pl-panel-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
	.pl-panel-artist { font-size: 0.8125rem; color: rgba(255,255,255,.5); margin: 0; }
	.pl-panel-title { font-size: 1.0625rem; font-weight: 700; margin: 0 0 12px; }
	.pl-panel-fav {
		flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		background: transparent; border: none; color: rgba(255,255,255,.3); cursor: pointer; border-radius: 999px;
	}
	.pl-panel-fav:hover { background: rgba(255,255,255,.06); }
	.pl-panel-fav.active { color: rgb(139, 92, 246); }
	.pl-panel-fav svg { width: 18px; height: 18px; }

	.pl-progress-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
	.pl-progress-time { font-size: 0.6875rem; color: rgba(255,255,255,.35); font-variant-numeric: tabular-nums; min-width: 30px; }
	.pl-progress-time:last-child { text-align: right; }
	.pl-progress {
		flex: 1; height: 3px; background: rgba(255,255,255,.12); border-radius: 999px; cursor: pointer; position: relative;
	}
	.pl-progress-fill { height: 100%; background: rgba(139, 92, 246, 0.9); border-radius: 999px; }

	.pl-panel-controls {
		display: flex; align-items: center; justify-content: center; gap: 14px;
		padding: 10px 0 14px; border-bottom: 1px solid rgba(255,255,255,.06); margin-bottom: 12px;
	}
	.pl-panel-controls button {
		background: transparent; border: none; color: #fff; cursor: pointer;
		width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
		border-radius: 999px; transition: background .12s; position: relative;
	}
	.pl-panel-controls button:hover:not(:disabled) { background: rgba(255,255,255,.08); }
	.pl-panel-controls button:disabled { color: rgba(255,255,255,.2); cursor: default; }
	.pl-panel-controls svg { width: 20px; height: 20px; }
	.pl-ctrl-shuffle svg, .pl-ctrl-repeat svg { width: 16px; height: 16px; }
	.pl-ctrl-shuffle.active, .pl-ctrl-repeat.active { color: rgba(139, 92, 246, 1); background: rgba(139, 92, 246, 0.14); }
	.pl-ctrl-repeat-one {
		position: absolute; top: 2px; right: 2px; width: 12px; height: 12px; border-radius: 999px;
		background: rgba(139, 92, 246, 1); color: #fff; font-size: 0.5625rem; font-weight: 700;
		display: flex; align-items: center; justify-content: center; line-height: 1;
	}
	.pl-ctrl-play {
		width: 44px !important; height: 44px !important; background: #fff !important; color: #09090f !important;
	}
	.pl-ctrl-play:hover { background: rgba(255,255,255,.9) !important; }
	.pl-ctrl-play svg { width: 22px; height: 22px; }
	.pl-panel-bio { font-size: 0.75rem; line-height: 1.6; color: rgba(255,255,255,.45); margin: 0; }

	.pl-panel-volume {
		display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; color: rgba(255,255,255,.6);
	}
	.pl-volume-icon {
		flex: none; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
		background: transparent; border: none; color: inherit; cursor: pointer; border-radius: 999px;
	}
	.pl-volume-icon:hover { background: rgba(255,255,255,.08); color: #fff; }
	.pl-volume-icon svg { width: 17px; height: 17px; }
	.pl-panel-volume input[type="range"] {
		flex: 1; height: 5px; appearance: none; border-radius: 999px; outline: none;
	}
	.pl-panel-volume input[type="range"]::-webkit-slider-thumb {
		appearance: none; width: 14px; height: 14px; border-radius: 999px; background: #fff; cursor: pointer;
		box-shadow: 0 0 0 3px rgba(0,0,0,.25);
	}
	.pl-panel-volume input[type="range"]::-moz-range-thumb {
		width: 14px; height: 14px; border: none; border-radius: 999px; background: #fff; cursor: pointer;
		box-shadow: 0 0 0 3px rgba(0,0,0,.25);
	}
	.pl-volume-pct {
		flex: none; width: 36px; text-align: right; font-size: 0.75rem; font-variant-numeric: tabular-nums;
		color: rgba(255,255,255,.5);
	}

	.pl-panel-more { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.06); }
	.pl-panel-more-label {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
		color: rgba(255,255,255,.35); margin: 0 0 8px;
	}
	.pl-more-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.pl-more-btn {
		width: 100%; display: flex; align-items: center; gap: 10px; padding: 6px;
		background: transparent; border: none; color: inherit; text-align: left; cursor: pointer;
		border-radius: 6px; transition: background .12s;
	}
	.pl-more-btn:hover { background: rgba(255,255,255,.05); }
	.pl-more-btn img { width: 32px; height: 32px; flex: none; object-fit: cover; }
	.pl-more-text { display: flex; flex-direction: column; min-width: 0; }
	.pl-more-artist { font-size: 0.625rem; color: rgba(255,255,255,.4); }
	.pl-more-title { font-size: 0.75rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.pl-panel--empty { aspect-ratio: auto; }
	.pl-panel-empty {
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 10px; padding: 60px 20px; color: rgba(255,255,255,.25); text-align: center;
	}
	.pl-panel-empty svg { width: 36px; height: 36px; }
	.pl-panel-empty p { font-size: 0.8125rem; margin: 0; }

	/* Un seul menu deroulant plutot qu'une rangee de pastilles qui debordent
	   et se ressemblent toutes : un point de decision clair, pas une liste a
	   scanner (retour direct de Jonathan, 19/09 : "meme moi j'en fais quoi"). */
	.pl-tab-select { margin-bottom: 16px; }
	.pl-tab-select-label {
		display: block; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
		color: rgba(255,255,255,.35); margin-bottom: 6px;
	}
	.pl-tab-select-control { position: relative; }
	.pl-tab-select-control select {
		width: 100%; appearance: none; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
		border-radius: 8px; padding: 10px 40px 10px 14px; color: #fff; font-size: 0.875rem; font-weight: 600; cursor: pointer;
	}
	.pl-tab-select-control select:focus { outline: none; border-color: rgba(139, 92, 246, 0.5); }
	.pl-tab-select-control select option { background: #14121a; color: #fff; }
	.pl-tab-select-chevron {
		position: absolute; right: 14px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px;
		color: rgba(255,255,255,.4); pointer-events: none;
	}

	.pl-empty-tab { font-size: 0.8125rem; color: rgba(255,255,255,.35); padding: 24px 4px; text-align: center; }

	.pl-search {
		display: flex; align-items: center; gap: 10px; margin-bottom: 20px; padding: 8px 12px;
		background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 8px;
	}
	.pl-search svg { width: 16px; height: 16px; color: rgba(255,255,255,.35); flex: none; }
	.pl-search input {
		flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 0.8125rem;
	}
	.pl-search input::placeholder { color: rgba(255,255,255,.3); }

	.pl-hero { display: flex; align-items: flex-end; gap: 20px; margin-bottom: 32px; }
	.pl-hero-art { width: 132px; height: 132px; flex: none; overflow: hidden; box-shadow: 0 16px 40px -12px rgba(0,0,0,.6); }
	.pl-hero-art img { width: 100%; height: 100%; object-fit: cover; }
	.pl-hero-kicker { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: rgba(139, 92, 246, 0.85); margin: 0 0 6px; }
	.pl-hero-title { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 8px; }
	.pl-hero-meta { font-size: 0.8125rem; color: rgba(255,255,255,.45); margin: 0; }

	.pl-section { margin-bottom: 28px; }
	.pl-section-title {
		font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
		color: rgba(255,255,255,.4); margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,.06);
	}

	.pl-list { list-style: none; margin: 0; padding: 0; }
	.pl-row { border-radius: 6px; display: flex; align-items: center; }
	.pl-row--active { background: rgba(139, 92, 246, 0.1); }

	.pl-row-btn {
		flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 7px 10px;
		background: transparent; border: none; color: inherit; text-align: left; cursor: pointer;
		border-radius: 6px; transition: background .12s;
	}
	.pl-row-btn:hover { background: rgba(255,255,255,.04); }

	.pl-row-fav {
		flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		background: transparent; border: none; color: rgba(255,255,255,.2); cursor: pointer; border-radius: 999px;
		transition: color .12s, background .12s;
	}
	.pl-row-fav:hover { background: rgba(255,255,255,.06); color: rgba(255,255,255,.5); }
	.pl-row-fav.active { color: rgb(139, 92, 246); }
	.pl-row-fav svg { width: 15px; height: 15px; }

	.pl-row-n { width: 22px; flex: none; font-size: 0.75rem; font-variant-numeric: tabular-nums; color: rgba(255,255,255,.3); text-align: right; }
	.pl-row--active .pl-row-n { color: rgba(139, 92, 246, 0.9); }

	.pl-row-thumb { position: relative; width: 40px; height: 40px; flex: none; overflow: hidden; background: rgba(255,255,255,.05); }
	.pl-row-thumb img { width: 100%; height: 100%; object-fit: cover; }
	.pl-row-play {
		position: absolute; inset: 0; width: 16px; height: 16px; margin: auto; color: #fff; opacity: 0;
		filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); transition: opacity .12s;
	}
	.pl-row-btn:hover .pl-row-play, .pl-row--active .pl-row-play { opacity: 1; }

	.pl-row-text { display: flex; flex-direction: column; min-width: 0; }
	.pl-row-artist { font-size: 0.6875rem; color: rgba(255,255,255,.4); }
	.pl-row-title { font-size: 0.8125rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl-row-title--unknown { font-style: italic; color: rgba(255,255,255,.4); font-weight: 400; }

	/* Mini-lecteur colle en bas, visible pendant le scroll de la liste sur
	   mobile : sur desktop le panneau sticky suffit deja, ce bandeau reste
	   cache (display:none par defaut, reactive seulement dans le media query
	   mobile ci-dessous). */
	.pl-mini {
		display: none;
		position: fixed; left: 0; right: 0; bottom: var(--bottom-nav-h, 0px); z-index: 40;
		align-items: center; gap: 10px; padding: 8px 12px;
		background: #0d0b12; border-top: 1px solid rgba(255,255,255,.08);
		width: 100%; text-align: left; cursor: pointer; overflow: hidden;
	}
	.pl-mini img { width: 36px; height: 36px; flex: none; object-fit: cover; border-radius: 4px; }
	.pl-mini-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.pl-mini-artist { font-size: 0.625rem; color: rgba(255,255,255,.4); }
	.pl-mini-title { font-size: 0.8125rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl-mini-play {
		flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		color: #fff; border-radius: 999px;
	}
	.pl-mini-play svg { width: 18px; height: 18px; }
	.pl-mini-progress {
		position: absolute; left: 0; bottom: 0; height: 2px; background: rgba(139, 92, 246, 0.9);
	}

	@media (max-width: 900px) {
		.pl-page { padding: 20px 16px calc(72px + var(--bottom-nav-h, 0px)); }
		.pl-layout { grid-template-columns: 1fr; }
		.pl-panel-slot { order: -1; }
		.pl-hero { flex-direction: column; align-items: flex-start; }
		.pl-hero-art { width: 100px; height: 100px; }
		.pl-mini { display: flex; }
	}
</style>
