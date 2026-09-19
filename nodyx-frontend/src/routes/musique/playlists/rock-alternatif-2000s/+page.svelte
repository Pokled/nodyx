<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import PlaylistPlayer, { type Track } from '$lib/components/music/PlaylistPlayer.svelte';

	const tFn = $derived($t);

	// Playlist personnelle, hors du pipeline d'upload du module Musique (pas de
	// fichier audio a heberger, ce sont des liens YouTube). Donnee statique par
	// choix assume, meme apres l'extraction de PlaylistPlayer.svelte : c'est
	// toujours une playlist figee, pas encore branchee sur /admin/music
	// (SPECS/NODYX_MUSIQUE_PLAYLISTS_CDC.md, plan pret, pas execute).
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

	// $derived (pas un const calcule une fois) : la bio doit se retraduire si
	// la langue change en cours de visite, comme le reste de la page.
	const tracksWithBios = $derived(
		allTracks.map((track) => ({
			...track,
			description: !track.unknown && artistInfo[track.artist] ? tFn(artistInfo[track.artist]) : undefined,
		})),
	);

	// "all" en premier (donc onglet par defaut) : le lien d'entree sur /musique
	// annonce "50 titres", atterrir sur un onglet qui n'en montre que 20 (Tes
	// morceaux) contredisait la promesse (retour Jonathan, 19/09).
	const customSections = $derived([
		{ id: 'all', label: tFn('music.playlist.section_all'), trackYts: allTracks.map((t) => t.yt) },
		{ id: 'yours', label: tFn('music.playlist.section_yours'), trackYts: section1.map((t) => t.yt) },
		{ id: 'new', label: `🔥 ${tFn('music.playlist.section_new')}`, trackYts: section2.map((t) => t.yt) },
	]);

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

<PlaylistPlayer
	tracks={tracksWithBios}
	customSections={customSections}
	eyebrow={tFn('music.playlist.eyebrow')}
	pageTitle="Rock / Alternative - 2000s"
	heroThumbYt={section1[6].yt}
	backHref="/musique"
	storageKey="rock-alternatif-2000s"
/>
