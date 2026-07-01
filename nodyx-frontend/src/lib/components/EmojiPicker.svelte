<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { customEmojisStore, loadCustomEmojis, type CustomEmoji } from '$lib/customEmojis';

	type Props = {
		onselect: (emoji: string) => void;
	};

	let { onselect }: Props = $props();
	const tFn = $derived($t);

	let activeCategory = $state(0);

	const custom = $derived($customEmojisStore);
	const hasCustom = $derived(custom.length > 0);

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

	// Onglet Custom (emojis de la bibliothèque) en TÊTE si présent
	type Tab =
		| { type: 'custom';  label: string; name: string; items: CustomEmoji[] }
		| { type: 'unicode'; label: string; name: string; items: string[] };

	const tabs = $derived<Tab[]>([
		...(hasCustom ? [{ type: 'custom' as const, label: '⭐', name: tFn('emoji.custom'), items: custom }] : []),
		...UNICODE.map(c => ({ type: 'unicode' as const, label: c.label, name: c.name, items: c.emojis })),
	]);

	const activeTab = $derived(tabs[activeCategory] ?? tabs[0]);
</script>

<div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden" style="width: 288px;">
	<!-- Category tabs -->
	<div class="flex border-b border-gray-800 bg-gray-950/80">
		{#each tabs as cat, i}
			{#if cat.type === 'custom'}
				<!-- Onglet des emojis de l'instance : mis en avant (accent + label) -->
				<button
					onclick={() => (activeCategory = i)}
					title={cat.name}
					class="flex items-center gap-1 px-2.5 py-2 text-xs font-bold uppercase tracking-wide border-r border-gray-800 transition-colors {activeCategory === i
						? 'text-white'
						: 'text-gray-300 hover:text-white'}"
					style="background: rgb(var(--nx-accent-2-rgb) / {activeCategory === i ? '0.28' : '0.16'}); box-shadow: inset 0 -2px 0 var(--nx-accent-2-soft)"
				><span class="text-sm">{cat.label}</span> {cat.name}</button>
			{:else}
				<button
					onclick={() => (activeCategory = i)}
					title={cat.name}
					class="flex-1 py-2 text-base transition-colors {activeCategory === i
						? 'bg-gray-800/80 text-white'
						: 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'}"
				>{cat.label}</button>
			{/if}
		{/each}
	</div>

	<!-- Emoji grid -->
	<div class="p-1.5 grid grid-cols-8 gap-0 max-h-52 overflow-y-auto" style="scrollbar-width:thin; scrollbar-color: rgba(255,255,255,0.1) transparent;">
		{#if activeTab?.type === 'custom'}
			{#each activeTab.items as e (e.shortcode)}
				<button
					onclick={() => onselect(`:${e.shortcode}:`)}
					title={`:${e.shortcode}:`}
					class="p-1.5 rounded hover:bg-gray-700 transition-colors flex items-center justify-center"
				><img src={e.url} alt={`:${e.shortcode}:`} class="w-6 h-6 object-contain" draggable="false" /></button>
			{/each}
		{:else if activeTab}
			{#each activeTab.items as emoji}
				<button
					onclick={() => onselect(emoji)}
					class="text-xl p-1.5 rounded hover:bg-gray-700 transition-colors leading-none text-center"
				>{emoji}</button>
			{/each}
		{/if}
	</div>
</div>
