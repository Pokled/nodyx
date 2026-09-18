<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from '$lib/i18n';

	const tFn = $derived($t);

	// Classification large et verifiable (genre principal du groupe / du titre,
	// pas une etiquette marketing) : sert uniquement a suggerer "plus dans le
	// meme genre" dans le panneau, jamais affichee comme une verite absolue.
	type Genre = 'post_grunge' | 'pop_punk' | 'alt_rock' | 'nu_metal' | 'alt_metal' | 'metalcore' | 'post_hardcore';

	interface Track {
		n:       number;
		artist:  string;
		title:   string;
		yt:      string;
		unknown?: boolean;
		genre?:  Genre;
	}

	const genreLabel: Record<Genre, string> = {
		post_grunge:   'music.playlist.genre.post_grunge',
		pop_punk:      'music.playlist.genre.pop_punk',
		alt_rock:      'music.playlist.genre.alt_rock',
		nu_metal:      'music.playlist.genre.nu_metal',
		alt_metal:     'music.playlist.genre.alt_metal',
		metalcore:     'music.playlist.genre.metalcore',
		post_hardcore: 'music.playlist.genre.post_hardcore',
	};

	// Playlist personnelle, hors du pipeline d'upload du module Musique (pas de
	// fichier audio a heberger, ce sont des liens YouTube). Donnee statique par
	// choix assume : une seule playlist pour une seule personne pour l'instant,
	// pas encore le cas d'usage generique qui justifierait un ecran admin dedie.
	const section1: Track[] = [
		{ n: 1,  artist: '3 Doors Down',                  title: 'Kryptonite',                                    yt: 'xPU8OAjjS4k', genre: 'post_grunge' },
		{ n: 2,  artist: 'blink-182',                     title: 'I Miss You',                                    yt: 's1tAYmMjLdY', genre: 'pop_punk' },
		{ n: 3,  artist: 'blink-182',                     title: "Adam's Song",                                   yt: '2MRdtXWcgIw', genre: 'pop_punk' },
		{ n: 4,  artist: 'Blue October',                  title: 'Hate Me',                                       yt: 'dDxgSvJINlU', genre: 'alt_rock' },
		{ n: 5,  artist: 'Apocalyptica feat. Brent Smith', title: 'Not Strong Enough',                             yt: 'AlZuqUTgcss', genre: 'alt_metal' },
		{ n: 6,  artist: 'Disturbed',                     title: 'The Sound of Silence',                          yt: 'u9Dg-g7t2l4', genre: 'alt_metal' },
		{ n: 7,  artist: 'Slipknot',                      title: 'Psychosocial',                                  yt: '5abamRO41fE', genre: 'nu_metal' },
		{ n: 8,  artist: 'Korn',                          title: 'Freak on a Leash',                              yt: 'jRGrNDV2mKc', genre: 'nu_metal' },
		{ n: 9,  artist: 'Drowning Pool',                 title: 'Bodies',                                        yt: '04F4xlWSFh0', genre: 'nu_metal' },
		{ n: 10, artist: 'Thirty Seconds to Mars',        title: 'The Kill',                                      yt: '8yvGCAvOAfM', genre: 'alt_rock' },
		{ n: 11, artist: 'Foo Fighters',                  title: 'Best of You',                                   yt: 'h_L4Rixya64', genre: 'post_grunge' },
		{ n: 12, artist: 'Snow Patrol',                   title: 'Chasing Cars',                                  yt: 'GemKqzILV4w', genre: 'alt_rock' },
		{ n: 13, artist: 'Cold',                          title: 'Stupid Girl',                                   yt: 'fGT1QRyVYvY', genre: 'nu_metal' },
		{ n: 14, artist: 'Chevelle',                      title: 'Closure',                                       yt: 'ZVJmMbf8wAo', genre: 'alt_metal' },
		{ n: 15, artist: 'Evans Blue',                    title: "Cold (But I'm Still Here)",                     yt: 'Oatd5Hrh3Pg', genre: 'alt_metal' },
		{ n: 16, artist: 'Sick Puppies',                  title: 'All the Same',                                  yt: 'cs72v-2zjsg', genre: 'post_grunge' },
		{ n: 17, artist: 'Bullet for My Valentine',       title: 'All These Things I Hate (Revolve Around Me)',   yt: '4q3KTBBsbpE', genre: 'metalcore' },
		{ n: 18, artist: 'Billy Talent',                  title: 'Surrender',                                     yt: 'aqP4-dUMkMc', genre: 'post_hardcore' },
		{ n: 19, artist: '',                               title: '',                                              yt: '3JKOnYh6snc', unknown: true },
		{ n: 20, artist: '',                               title: '',                                              yt: 'KDl0LLH4q7I', unknown: true },
	];

	const section2: Track[] = [
		{ n: 21, artist: 'Breaking Benjamin',      title: 'The Diary of Jane',              yt: 'DWaB4PXCwFU', genre: 'post_grunge' },
		{ n: 22, artist: 'Breaking Benjamin',      title: 'So Cold',                        yt: 'rTiGlNDnOtE', genre: 'post_grunge' },
		{ n: 23, artist: 'Breaking Benjamin',      title: 'Breath',                         yt: 'qQ3qJmgktS0', genre: 'post_grunge' },
		{ n: 24, artist: 'Breaking Benjamin',      title: 'Sooner or Later',                yt: 'RpdFoizbnTg', genre: 'post_grunge' },
		{ n: 25, artist: 'Chevelle',               title: 'Send the Pain Below',            yt: 'gpyRI1j9t6c', genre: 'alt_metal' },
		{ n: 26, artist: 'Chevelle',               title: 'Well Enough Alone',              yt: 'tr6kM9HKjRc', genre: 'alt_metal' },
		{ n: 27, artist: 'Chevelle',               title: 'The Clincher',                   yt: 'OP3Yhs8q7oM', genre: 'alt_metal' },
		{ n: 28, artist: 'Papa Roach',             title: 'Last Resort',                    yt: 'j0lSpNtjPM8', genre: 'nu_metal' },
		{ n: 29, artist: 'Papa Roach',             title: 'Broken Home',                    yt: 'yERDDbP53Sw', genre: 'nu_metal' },
		{ n: 30, artist: 'Papa Roach',             title: 'Between Angels and Insects',     yt: 'H2jCbXiEQI4', genre: 'nu_metal' },
		{ n: 31, artist: 'Drowning Pool',          title: 'Tear Away',                      yt: 'gCSs5QggRUk', genre: 'nu_metal' },
		{ n: 32, artist: 'Mudvayne',               title: 'Dig',                            yt: 'YIqbdnaPcT8', genre: 'nu_metal' },
		{ n: 33, artist: 'Mudvayne',               title: 'Not Falling',                    yt: 'Rh9Mtbe6Lkw', genre: 'nu_metal' },
		{ n: 34, artist: 'Mudvayne',               title: 'World So Cold',                  yt: 'A0S9ck12Cd0', genre: 'nu_metal' },
		{ n: 35, artist: 'Deftones',               title: 'My Own Summer (Shove It)',       yt: 'XOzs1FehYOA', genre: 'alt_metal' },
		{ n: 36, artist: 'Deftones',               title: 'Change (In the House of Flies)', yt: 'WPpDyIJdasg', genre: 'alt_metal' },
		{ n: 37, artist: 'Incubus',                title: 'Drive',                          yt: 'fgT9zGkiLig', genre: 'alt_rock' },
		{ n: 38, artist: 'Incubus',                title: 'Megalomaniac',                   yt: 'VJLDjW6D9xM', genre: 'alt_metal' },
		{ n: 39, artist: 'Disturbed',              title: 'Down With the Sickness',         yt: '09LTT0xwdfw', genre: 'nu_metal' },
		{ n: 40, artist: 'Disturbed',              title: 'Stricken',                       yt: '3moLkjvhEu0', genre: 'alt_metal' },
		{ n: 41, artist: 'System of a Down',       title: 'Toxicity',                       yt: 'iywaBOMvYLI', genre: 'nu_metal' },
		{ n: 42, artist: 'System of a Down',       title: 'B.Y.O.B.',                       yt: 'zUzd9KyIDrM', genre: 'nu_metal' },
		{ n: 43, artist: 'Seether',                title: 'Remedy',                         yt: 'FZLILV18ut8', genre: 'post_grunge' },
		{ n: 44, artist: 'Seether',                title: 'Fake It',                        yt: '3qN6uWzK5LQ', genre: 'post_grunge' },
		{ n: 45, artist: 'Trapt',                  title: 'Headstrong',                     yt: 'HTvu1Yr3Ohk', genre: 'post_grunge' },
		{ n: 46, artist: 'Trapt',                  title: 'Still Frame',                    yt: 'Fhp5aCBR_as', genre: 'post_grunge' },
		{ n: 47, artist: 'Audioslave',              title: 'Like a Stone',                   yt: '7QU1nvuxaMA', genre: 'alt_rock' },
		{ n: 48, artist: '10 Years',                title: 'Wasteland',                      yt: 'OPXUeeFXc90', genre: 'alt_metal' },
		{ n: 49, artist: 'Taproot',                 title: 'Poem',                           yt: '9YGL3amPmyc', genre: 'nu_metal' },
		{ n: 50, artist: 'Sick Puppies',            title: "You're Going Down",              yt: 'liW-kWFiXtQ', genre: 'post_grunge' },
	];

	const allTracks = [...section1, ...section2];

	// Verifie une par une (WebSearch, 19/09), jamais devine : un an ou un pays
	// faux serait pire que ne rien afficher. Pas de fiche pour les 2 titres non
	// identifies, il n'y a rien de fiable a en dire. La cle i18n porte le texte
	// (music.playlist.bio.*, fr.json + en.json), jamais la chaine en dur ici :
	// meme regle que partout ailleurs dans Nodyx.
	const artistInfo: Record<string, string> = {
		'3 Doors Down':                    'music.playlist.bio.3doorsdown',
		'blink-182':                       'music.playlist.bio.blink182',
		'Blue October':                    'music.playlist.bio.blueoctober',
		'Apocalyptica feat. Brent Smith':  'music.playlist.bio.apocalyptica',
		'Disturbed':                       'music.playlist.bio.disturbed',
		'Slipknot':                        'music.playlist.bio.slipknot',
		'Korn':                            'music.playlist.bio.korn',
		'Drowning Pool':                   'music.playlist.bio.drowningpool',
		'Thirty Seconds to Mars':          'music.playlist.bio.thirtysecondstomars',
		'Foo Fighters':                    'music.playlist.bio.foofighters',
		'Snow Patrol':                     'music.playlist.bio.snowpatrol',
		'Cold':                            'music.playlist.bio.cold',
		'Chevelle':                        'music.playlist.bio.chevelle',
		'Evans Blue':                      'music.playlist.bio.evansblue',
		'Sick Puppies':                    'music.playlist.bio.sickpuppies',
		'Bullet for My Valentine':         'music.playlist.bio.bulletformyvalentine',
		'Billy Talent':                    'music.playlist.bio.billytalent',
		'Breaking Benjamin':               'music.playlist.bio.breakingbenjamin',
		'Papa Roach':                      'music.playlist.bio.paparoach',
		'Mudvayne':                        'music.playlist.bio.mudvayne',
		'Deftones':                        'music.playlist.bio.deftones',
		'Incubus':                         'music.playlist.bio.incubus',
		'System of a Down':                'music.playlist.bio.systemofadown',
		'Seether':                         'music.playlist.bio.seether',
		'Trapt':                           'music.playlist.bio.trapt',
		'Audioslave':                      'music.playlist.bio.audioslave',
		'10 Years':                        'music.playlist.bio.tenyears',
		'Taproot':                         'music.playlist.bio.taproot',
	};

	let nowPlaying = $state<Track | null>(null);
	let history: Track[] = $state([]);
	let shuffle = $state(false);
	let volume = $state(80);

	function play(track: Track) {
		if (nowPlaying && nowPlaying.yt !== track.yt) history.push(nowPlaying);
		nowPlaying = track;
	}

	const currentIndex = $derived(nowPlaying ? allTracks.findIndex((t) => t.yt === nowPlaying!.yt) : -1);
	const hasPrev = $derived(history.length > 0);
	const hasNext = $derived(shuffle ? allTracks.length > 1 : currentIndex >= 0 && currentIndex < allTracks.length - 1);

	function playPrev() {
		const prev = history.pop();
		if (prev) nowPlaying = prev;
	}
	function playNext() {
		if (!nowPlaying || !hasNext) return;
		const next = shuffle
			? allTracks.filter((t) => t.yt !== nowPlaying!.yt)[Math.floor(Math.random() * (allTracks.length - 1))]
			: allTracks[currentIndex + 1];
		play(next);
	}

	// Suggestions "plus dans le meme genre" : catalogue fige, jamais de titre
	// invente hors de la liste des 50 pistes deja verifiees une par une.
	const suggestions = $derived(
		nowPlaying?.genre
			? allTracks.filter((t) => t.genre === nowPlaying!.genre && t.yt !== nowPlaying!.yt).slice(0, 4)
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
		const w = window as any;
		if (w.YT && w.YT.Player) {
			apiReady = true;
			return;
		}
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
						if (e.data === w.YT.PlayerState.ENDED) playNext();
					},
				},
			});
		} else if (typeof player.loadVideoById === 'function') {
			player.loadVideoById(nowPlaying.yt);
		}
	});

	function onVolumeInput() {
		player?.setVolume?.(volume);
	}

	const total = allTracks.length;
	const pageTitle = $derived(`${tFn('music.playlist.eyebrow')} - 2000s · Nodyx`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={tFn('music.playlist.meta_desc')} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={tFn('music.playlist.meta_desc')} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:image" content={`https://img.youtube.com/vi/${section1[0].yt}/hqdefault.jpg`} />
</svelte:head>

<div class="pl-page">
	<a href="/musique" class="pl-back">← {tFn('music.playlist.back')}</a>

	<div class="pl-layout">
		<div class="pl-main">
			<header class="pl-hero">
				<div class="pl-hero-art">
					<img src={`https://img.youtube.com/vi/${section1[6].yt}/hqdefault.jpg`} alt="" loading="lazy" />
				</div>
				<div class="pl-hero-info">
					<p class="pl-hero-kicker">{tFn('music.playlist.eyebrow')}</p>
					<h1 class="pl-hero-title">Rock / Alternative - 2000s</h1>
					<p class="pl-hero-meta">{tFn('music.playlist.track_count').replace('{{n}}', String(total))}</p>
				</div>
			</header>

			<section class="pl-section">
				<h2 class="pl-section-title">{tFn('music.playlist.section_yours')}</h2>
				<ol class="pl-list">
					{#each section1 as track (track.n)}
						<li class="pl-row" class:pl-row--active={nowPlaying?.yt === track.yt}>
							<button type="button" class="pl-row-btn" onclick={() => play(track)}
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
						</li>
					{/each}
				</ol>
			</section>

			<section class="pl-section">
				<h2 class="pl-section-title">🔥 {tFn('music.playlist.section_new')}</h2>
				<ol class="pl-list" start={section1.length + 1}>
					{#each section2 as track (track.n)}
						<li class="pl-row" class:pl-row--active={nowPlaying?.yt === track.yt}>
							<button type="button" class="pl-row-btn" onclick={() => play(track)} aria-label={`${track.artist} - ${track.title}`}>
								<span class="pl-row-n">{track.n}</span>
								<span class="pl-row-thumb">
									<img src={`https://img.youtube.com/vi/${track.yt}/default.jpg`} alt="" loading="lazy" />
									<svg class="pl-row-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
								</span>
								<span class="pl-row-text">
									<span class="pl-row-artist">{track.artist}</span>
									<span class="pl-row-title">{track.title}</span>
								</span>
							</button>
						</li>
					{/each}
				</ol>
			</section>
		</div>

		<aside class="pl-panel" class:pl-panel--empty={!nowPlaying}>
			{#if nowPlaying}
				<div class="pl-panel-frame">
					<div bind:this={playerHost}></div>
				</div>
				<div class="pl-panel-body">
					<p class="pl-panel-label">{tFn('music.playlist.now_playing')}</p>
					{#if nowPlaying.unknown}
						<p class="pl-panel-title">{tFn('music.playlist.unknown_track')}</p>
					{:else}
						<p class="pl-panel-artist">{nowPlaying.artist}</p>
						<p class="pl-panel-title">{nowPlaying.title}</p>
					{/if}

					<div class="pl-panel-controls">
						<button type="button" class="pl-ctrl-shuffle" class:active={shuffle} onclick={() => (shuffle = !shuffle)} aria-pressed={shuffle} aria-label={tFn('music.playlist.shuffle')}>
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
						<span class="pl-panel-position">{nowPlaying.n} / {total}</span>
						<button type="button" onclick={playNext} disabled={!hasNext} aria-label={tFn('music.playlist.next')}>
							<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
						</button>
					</div>

					<div class="pl-panel-volume">
						<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1-3.29-2.5-4.03v8.05c1.5-.74 2.5-2.26 2.5-4.02z"/></svg>
						<input type="range" min="0" max="100" bind:value={volume} oninput={onVolumeInput} aria-label={tFn('music.playlist.volume')} />
					</div>

					{#if !nowPlaying.unknown && artistInfo[nowPlaying.artist]}
						<p class="pl-panel-bio">{tFn(artistInfo[nowPlaying.artist])}</p>
					{/if}
					{#if nowPlaying.genre}
						<span class="pl-panel-genre">{tFn(genreLabel[nowPlaying.genre])}</span>
					{/if}

					{#if suggestions.length > 0}
						<div class="pl-panel-more">
							<p class="pl-panel-more-label">{tFn('music.playlist.more_like_this')}</p>
							<ul class="pl-more-list">
								{#each suggestions as s (s.yt)}
									<li>
										<button type="button" class="pl-more-btn" onclick={() => play(s)}>
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

	.pl-panel {
		position: sticky;
		top: 24px;
		background: rgba(255,255,255,.03);
		border: 1px solid rgba(255,255,255,.06);
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
	.pl-panel-artist { font-size: 0.8125rem; color: rgba(255,255,255,.5); margin: 0; }
	.pl-panel-title { font-size: 1.0625rem; font-weight: 700; margin: 0 0 12px; }
	.pl-panel-controls {
		display: flex; align-items: center; justify-content: center; gap: 20px;
		padding: 10px 0 14px; border-bottom: 1px solid rgba(255,255,255,.06); margin-bottom: 12px;
	}
	.pl-panel-controls button {
		background: transparent; border: none; color: #fff; cursor: pointer;
		width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
		border-radius: 999px; transition: background .12s;
	}
	.pl-panel-controls button:hover:not(:disabled) { background: rgba(255,255,255,.08); }
	.pl-panel-controls button:disabled { color: rgba(255,255,255,.2); cursor: default; }
	.pl-panel-controls svg { width: 20px; height: 20px; }
	.pl-panel-position { font-size: 0.75rem; color: rgba(255,255,255,.4); font-variant-numeric: tabular-nums; min-width: 52px; text-align: center; }
	.pl-ctrl-shuffle svg { width: 16px; height: 16px; }
	.pl-ctrl-shuffle.active { color: rgba(139, 92, 246, 1); background: rgba(139, 92, 246, 0.14); }
	.pl-panel-bio { font-size: 0.75rem; line-height: 1.6; color: rgba(255,255,255,.45); margin: 0; }

	.pl-panel-volume {
		display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; color: rgba(255,255,255,.4);
	}
	.pl-panel-volume svg { width: 16px; height: 16px; flex: none; }
	.pl-panel-volume input[type="range"] {
		flex: 1; height: 3px; appearance: none; background: rgba(255,255,255,.12); border-radius: 999px; outline: none;
	}
	.pl-panel-volume input[type="range"]::-webkit-slider-thumb {
		appearance: none; width: 12px; height: 12px; border-radius: 999px; background: #fff; cursor: pointer;
	}
	.pl-panel-volume input[type="range"]::-moz-range-thumb {
		width: 12px; height: 12px; border: none; border-radius: 999px; background: #fff; cursor: pointer;
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
	.pl-row { border-radius: 6px; }
	.pl-row--active { background: rgba(139, 92, 246, 0.1); }

	.pl-row-btn {
		width: 100%; display: flex; align-items: center; gap: 12px; padding: 7px 10px;
		background: transparent; border: none; color: inherit; text-align: left; cursor: pointer;
		border-radius: 6px; transition: background .12s;
	}
	.pl-row-btn:hover { background: rgba(255,255,255,.04); }

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

	@media (max-width: 900px) {
		.pl-page { padding: 20px 16px 40px; }
		.pl-layout { grid-template-columns: 1fr; }
		.pl-panel { position: static; order: -1; }
		.pl-hero { flex-direction: column; align-items: flex-start; }
		.pl-hero-art { width: 100px; height: 100px; }
	}
</style>
