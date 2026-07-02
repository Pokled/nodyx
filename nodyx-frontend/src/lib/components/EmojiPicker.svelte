<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { customEmojisStore, loadCustomEmojis, type CustomEmoji } from '$lib/customEmojis';
	import { emojiUsageStore, topEmojis } from '$lib/emojiUsage';

	type Props = { onselect: (emoji: string) => void };
	let { onselect }: Props = $props();
	const tFn = $derived($t);

	let activeCategory = $state(0);
	let query = $state('');

	const custom = $derived($customEmojisStore);
	const hasCustom = $derived(custom.length > 0);
	const usage = $derived($emojiUsageStore);
	onMount(() => { loadCustomEmojis(); });

	const UNICODE = [
		{ label: '😀', name: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','🤖'] },
		{ label: '👋', name: 'Gestes', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🤝','🙏','💪','💅','🤳','👀','👁️','👅','👄','🫶','🫵','🫰','🤙'] },
		{ label: '❤️', name: 'Cœurs & Fêtes', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❣️','💕','💞','💓','💗','💖','💘','💝','✨','⭐','🌟','💫','🔥','💥','❄️','🌈','☀️','🌙','⚡','💦','🌊','🎉','🎊','🎈','🎁','🏆','🥇','🎯','🎮','🎲','🧩','🎭','🎨','🎬','🎤','🎧','🎶','🎵'] },
		{ label: '🐶', name: 'Animaux', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🦎','🐍','🐊','🐅','🐆','🦓','🐘','🦛','🦒','🦘','🐕','🐈','🐟','🐬','🐳','🦈','🐙','🦀','🦑','🦜','🦚','🦩','🕊️'] },
		{ label: '🍕', name: 'Nourriture', emojis: ['🍕','🍔','🌮','🌯','🥙','🍣','🍱','🍜','🍝','🍛','🍲','🥗','🍳','🥞','🥓','🥩','🍗','🍖','🌭','🥪','🧀','🥚','🍿','🧂','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧋','🥤','🍺','🍻','🍷','🥂','🍸','🍹','🧃','🧊','🍓','🍇','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🫐'] },
		{ label: '🚀', name: 'Voyage', emojis: ['🚀','✈️','🛸','🚂','🚗','🏎️','🚕','🚌','🚑','🚒','🛵','🏍️','🚲','⛵','🚤','🚢','🛩️','🚁','🗺️','🗼','🏰','🏯','🗽','🗻','🏔️','🌋','🏕️','🏖️','🏜️','🏝️','🏠','🏡','🏢','🏥','🏦','🏨','🏪','🏫','🏬','🏭','💒','🌍','🌎','🌏','🌐','🗾','🧭'] },
		{ label: '💡', name: 'Objets', emojis: ['💡','🔦','📱','💻','🖥️','⌨️','📺','📷','📹','🎥','📞','☎️','📡','🔋','🔌','🔑','🗝️','🔐','🔒','🔓','🔨','⚙️','🔧','🔩','🔗','🧲','🧰','📦','📫','📝','📌','📍','✂️','🔍','🔎','🔬','🔭','💊','🩹','🩺','🧬','🎵','🎶','🎸','🎹','🥁','🎺','🎷','🎻','📚','📖','📰','🗞️','📋','📊','📈','📉','🗒️','🗓️'] },
		{ label: '✅', name: 'Symboles', emojis: ['✅','❌','⚠️','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🆕','🆓','🆗','🆙','🆒','ℹ️','🔔','🔕','📢','📣','🔊','🔇','🔀','🔁','🔂','▶️','⏸️','⏭️','⏮️','⏩','⏪','⬆️','⬇️','⬅️','➡️','↕️','↔️','🔄','♻️','🚫','⛔','❓','❗','‼️','⁉️','💤','🔅','🔆','📶','📳','📴','📵','📱','🔐','🔏'] },
	];

	// Item de rendu unifié (image custom OU glyphe unicode)
	type Item = { key: string; display: 'img' | 'text'; src?: string; char?: string; sel: string; title: string };
	const customItem  = (e: CustomEmoji): Item => ({ key: 'c:' + e.shortcode, display: 'img',  src: e.url, sel: `:${e.shortcode}:`, title: `:${e.shortcode}:` });
	const unicodeItem = (ch: string): Item      => ({ key: 'u:' + ch,         display: 'text', char: ch,  sel: ch,                title: ch });

	const customBySc = $derived(new Map(custom.map(e => [e.shortcode, e])));

	// Fréquents : les plus utilisés par CE membre (custom + unicode mélangés)
	const freqItems = $derived(
		topEmojis(usage, 24)
			.map(k => {
				if (k.startsWith(':') && k.endsWith(':')) { const e = customBySc.get(k.slice(1, -1)); return e ? customItem(e) : null; }
				return unicodeItem(k);
			})
			.filter((x): x is Item => x !== null)
	);

	type Tab = { type: 'freq' | 'custom' | 'unicode'; label: string; name: string; items: Item[] };
	const tabs = $derived<Tab[]>([
		...(freqItems.length > 0 ? [{ type: 'freq' as const,   label: '🕘', name: tFn('emoji.frequent'), items: freqItems }] : []),
		...(hasCustom            ? [{ type: 'custom' as const, label: '⭐', name: tFn('emoji.custom'),   items: custom.map(customItem) }] : []),
		...UNICODE.map(c => ({ type: 'unicode' as const, label: c.label, name: c.name, items: c.emojis.map(unicodeItem) })),
	]);
	const activeTab = $derived(tabs[activeCategory] ?? tabs[0]);

	// Recherche : filtre les emojis CUSTOM (le vrai besoin quand il y en a 100+)
	const searchItems = $derived(
		query.trim()
			? custom.filter(e => e.shortcode.includes(query.trim().toLowerCase()) || e.name.toLowerCase().includes(query.trim().toLowerCase())).map(customItem)
			: []
	);
	const searching = $derived(query.trim().length > 0);
	const gridItems = $derived(searching ? searchItems : (activeTab?.items ?? []));
</script>

<div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden" style="width: 320px;">
	<!-- Recherche -->
	<div class="p-1.5 border-b border-gray-800">
		<input
			bind:value={query}
			placeholder={tFn('emoji.search_placeholder')}
			class="w-full px-2.5 py-1.5 text-sm rounded-md bg-gray-950 border border-gray-800 outline-none focus:border-gray-600"
			style="color: #e2e8f0" />
	</div>

	<!-- Onglets (masqués pendant la recherche) -->
	{#if !searching}
		<div class="flex border-b border-gray-800 bg-gray-950/80">
			{#each tabs as cat, i}
				{#if cat.type === 'custom'}
					<button onclick={() => (activeCategory = i)} title={cat.name}
						class="flex items-center gap-1 px-2.5 py-2 text-xs font-bold uppercase tracking-wide shrink-0 border-r border-gray-800 transition-colors {activeCategory === i ? 'text-white' : 'text-gray-300 hover:text-white'}"
						style="background: rgb(var(--nx-accent-2-rgb) / {activeCategory === i ? '0.28' : '0.16'}); box-shadow: inset 0 -2px 0 var(--nx-accent-2-soft)"
					><span class="text-sm">{cat.label}</span> {cat.name}</button>
				{:else}
					<button onclick={() => (activeCategory = i)} title={cat.name}
						class="{cat.type === 'freq' ? 'px-2.5 shrink-0' : 'flex-1 min-w-0'} py-2 text-base transition-colors {activeCategory === i ? 'bg-gray-800/80 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'}"
					>{cat.label}</button>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Grille -->
	<div class="p-1.5 grid grid-cols-8 gap-0 max-h-52 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.1) transparent;">
		{#each gridItems as it (it.key)}
			<button onclick={() => onselect(it.sel)} title={it.title}
				class="p-1.5 rounded hover:bg-gray-700 transition-colors flex items-center justify-center {it.display === 'text' ? 'text-xl leading-none' : ''}">
				{#if it.display === 'img'}
					<img src={it.src} alt={it.title} class="w-6 h-6 object-contain" draggable="false" />
				{:else}{it.char}{/if}
			</button>
		{/each}
		{#if gridItems.length === 0}
			<div class="col-span-8 py-6 text-center text-xs text-gray-600">{tFn('emoji.no_result')}</div>
		{/if}
	</div>
</div>
