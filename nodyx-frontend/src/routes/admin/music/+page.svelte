<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);
	const token = $derived((page.data as any).token as string);

	let { data }: { data: PageData } = $props();

	interface Category {
		id: string; slug: string; title: string; description: string | null;
		image_url: string | null; track_count: number;
	}
	interface Track {
		id: string; category_id: string; title: string; description: string | null;
		audio_url: string; image_url: string | null;
	}

	let categories  = $state<Category[]>(data.categories ?? []);
	let tracksByCat = $state<Record<string, Track[]>>({});
	let openCat     = $state<string | null>(null);
	let busy        = $state<string | null>(null); // clé de l'opération en cours (feedback UI)
	let errorMsg    = $state<string | null>(null);

	// ── Nouvelle catégorie ───────────────────────────────────────────────────
	let newCatTitle = $state('');
	let newCatDesc  = $state('');

	async function api(path: string, init: RequestInit = {}) {
		const res = await fetch(`/api/v1/music${path}`, {
			...init,
			headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? tFn('amusic.err_generic').replace('{{status}}', String(res.status)));
		}
		return res.status === 204 ? null : res.json();
	}

	async function uploadFile(kind: 'audio' | 'image', file: File): Promise<{ asset_id: string; url: string }> {
		const fd = new FormData();
		fd.append('file', file);
		const res = await fetch(`/api/v1/music/upload/${kind}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: fd,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? tFn('amusic.err_upload_failed').replace('{{kind}}', kind));
		}
		return res.json();
	}

	async function refreshCategories() {
		const json = await api('/categories');
		categories = json.categories;
	}

	async function createCategory() {
		if (newCatTitle.trim().length < 2) return;
		busy = 'create-category';
		errorMsg = null;
		try {
			await api('/categories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: newCatTitle.trim(), description: newCatDesc.trim() || undefined }),
			});
			newCatTitle = '';
			newCatDesc  = '';
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function deleteCategory(cat: Category) {
		if (!confirm(tFn('amusic.confirm_delete_category').replace('{{title}}', cat.title))) return;
		busy = `delete-category-${cat.id}`;
		errorMsg = null;
		try {
			await api(`/categories/${cat.id}`, { method: 'DELETE' });
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function updateCategoryText(cat: Category, title: string, description: string) {
		busy = `update-category-${cat.id}`;
		errorMsg = null;
		try {
			await api(`/categories/${cat.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, description: description || null }),
			});
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function changeCategoryImage(cat: Category, file: File) {
		busy = `image-category-${cat.id}`;
		errorMsg = null;
		try {
			const { asset_id } = await uploadFile('image', file);
			await api(`/categories/${cat.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image_asset_id: asset_id }),
			});
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function toggleCategory(cat: Category) {
		if (openCat === cat.id) { openCat = null; return; }
		openCat = cat.id;
		if (!tracksByCat[cat.id]) {
			const json = await api(`/categories/${cat.slug}`);
			tracksByCat = { ...tracksByCat, [cat.id]: json.tracks };
		}
	}

	async function refreshTracks(catId: string, slug: string) {
		const json = await api(`/categories/${slug}`);
		tracksByCat = { ...tracksByCat, [catId]: json.tracks };
	}

	// ── Nouveau morceau (par catégorie) ─────────────────────────────────────
	let newTrackTitle = $state<Record<string, string>>({});
	let newTrackDesc  = $state<Record<string, string>>({});
	let newTrackAudio = $state<Record<string, File | null>>({});
	let newTrackImage = $state<Record<string, File | null>>({});

	async function addTrack(cat: Category) {
		const title = (newTrackTitle[cat.id] ?? '').trim();
		const audio = newTrackAudio[cat.id];
		if (!title || !audio) return;
		busy = `add-track-${cat.id}`;
		errorMsg = null;
		try {
			const audioUp = await uploadFile('audio', audio);
			const image = newTrackImage[cat.id];
			const imageUp = image ? await uploadFile('image', image) : null;

			await api('/tracks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					category_id:    cat.id,
					title,
					description:    (newTrackDesc[cat.id] ?? '').trim() || undefined,
					audio_asset_id: audioUp.asset_id,
					image_asset_id: imageUp?.asset_id,
				}),
			});

			newTrackTitle = { ...newTrackTitle, [cat.id]: '' };
			newTrackDesc  = { ...newTrackDesc,  [cat.id]: '' };
			newTrackAudio = { ...newTrackAudio, [cat.id]: null };
			newTrackImage = { ...newTrackImage, [cat.id]: null };

			await refreshTracks(cat.id, cat.slug);
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function deleteTrack(cat: Category, track: Track) {
		if (!confirm(tFn('amusic.confirm_delete_track').replace('{{title}}', track.title))) return;
		busy = `delete-track-${track.id}`;
		errorMsg = null;
		try {
			await api(`/tracks/${track.id}`, { method: 'DELETE' });
			await refreshTracks(cat.id, cat.slug);
			await refreshCategories();
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head><title>{tFn('amusic.page_title')}</title></svelte:head>

<div>
	<div class="flex items-center justify-between mb-2">
		<h1 class="text-2xl font-bold text-white">{tFn('amusic.title')}</h1>
		<a href="/musique" target="_blank" class="text-xs text-indigo-400 hover:text-indigo-300">{tFn('amusic.view_public')} ↗</a>
	</div>
	<p class="text-sm text-gray-500 mb-6">{tFn('amusic.subtitle')}</p>

	{#if errorMsg}
		<p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">{errorMsg}</p>
	{/if}

	<!-- Nouvelle catégorie -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none">
			+ {tFn('amusic.new_category')}
		</summary>
		<div class="px-5 pb-5 pt-3 border-t border-gray-800 space-y-3">
			<div>
				<label for="new-cat-title" class="block text-xs text-gray-400 mb-1">{tFn('amusic.field_title')}</label>
				<input id="new-cat-title" type="text" bind:value={newCatTitle} maxlength="120"
					placeholder={tFn('amusic.category_title_ph')}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
			</div>
			<div>
				<label for="new-cat-desc" class="block text-xs text-gray-400 mb-1">{tFn('amusic.field_description')}</label>
				<textarea id="new-cat-desc" bind:value={newCatDesc} rows="2" maxlength="500"
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"></textarea>
			</div>
			<button type="button" onclick={createCategory} disabled={busy === 'create-category' || newCatTitle.trim().length < 2}
				class="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors">
				{busy === 'create-category' ? tFn('common.loading') : tFn('amusic.create_category')}
			</button>
		</div>
	</details>

	{#if categories.length === 0}
		<p class="text-sm text-gray-500">{tFn('amusic.empty')}</p>
	{/if}

	<div class="space-y-4">
		{#each categories as cat (cat.id)}
			<div class="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
				<div class="flex items-center gap-4 p-4">
					<label class="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-800 cursor-pointer group"
						title={tFn('amusic.change_image')}>
						{#if cat.image_url}
							<img src={cat.image_url} alt="" class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-1">{tFn('amusic.no_image')}</div>
						{/if}
						<div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white transition-opacity">
							{tFn('amusic.change_image')}
						</div>
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"
							onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) changeCategoryImage(cat, f); }} />
					</label>

					<div class="flex-1 min-w-0">
						<input type="text" value={cat.title} maxlength="120"
							onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== cat.title) updateCategoryText(cat, v, cat.description ?? ''); }}
							class="w-full bg-transparent text-white font-semibold text-sm focus:outline-none focus:border-b focus:border-indigo-500" />
						<input type="text" value={cat.description ?? ''} maxlength="500"
							placeholder={tFn('amusic.field_description')}
							onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v !== (cat.description ?? '')) updateCategoryText(cat, cat.title, v); }}
							class="w-full bg-transparent text-gray-500 text-xs mt-1 focus:outline-none focus:border-b focus:border-indigo-500" />
					</div>

					<span class="text-xs text-gray-500 shrink-0">{cat.track_count} {cat.track_count === 1 ? tFn('amusic.track_singular') : tFn('amusic.track_plural')}</span>

					<button type="button" onclick={() => toggleCategory(cat)}
						class="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1">
						{openCat === cat.id ? tFn('amusic.collapse') : tFn('amusic.manage_tracks')}
					</button>

					<button type="button" onclick={() => deleteCategory(cat)} disabled={busy === `delete-category-${cat.id}`}
						class="shrink-0 text-xs text-red-500 hover:text-red-400 px-2 py-1">
						{tFn('common.delete')}
					</button>
				</div>

				{#if openCat === cat.id}
					<div class="border-t border-gray-800 p-4 space-y-3 bg-gray-950/40">
						{#if tracksByCat[cat.id]}
							{#each tracksByCat[cat.id] as track (track.id)}
								<div class="flex items-center gap-3 rounded-lg bg-gray-900/50 border border-gray-800 p-2.5">
									{#if track.image_url}
										<img src={track.image_url} alt="" class="w-10 h-10 rounded object-cover shrink-0" />
									{/if}
									<div class="flex-1 min-w-0">
										<p class="text-sm text-white truncate">{track.title}</p>
										<audio src={track.audio_url} controls class="w-full h-8 mt-1"></audio>
									</div>
									<button type="button" onclick={() => deleteTrack(cat, track)} disabled={busy === `delete-track-${track.id}`}
										class="shrink-0 text-xs text-red-500 hover:text-red-400 px-2">
										{tFn('common.delete')}
									</button>
								</div>
							{:else}
								<p class="text-xs text-gray-500 italic">{tFn('music.empty_category')}</p>
							{/each}
						{/if}

						<div class="rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2">
							<p class="text-xs font-semibold text-indigo-300">{tFn('amusic.add_track')}</p>
							<input type="text" value={newTrackTitle[cat.id] ?? ''}
								oninput={(e) => { newTrackTitle = { ...newTrackTitle, [cat.id]: (e.target as HTMLInputElement).value }; }}
								placeholder={tFn('amusic.track_title_ph')} maxlength="150"
								class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500" />
							<input type="text" value={newTrackDesc[cat.id] ?? ''}
								oninput={(e) => { newTrackDesc = { ...newTrackDesc, [cat.id]: (e.target as HTMLInputElement).value }; }}
								placeholder={tFn('amusic.field_description')} maxlength="500"
								class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500" />
							<div class="flex flex-wrap gap-2 items-center">
								<label class="text-xs text-gray-400">
									{tFn('amusic.audio_file')}
									<input type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/flac,audio/x-m4a"
										onchange={(e) => { newTrackAudio = { ...newTrackAudio, [cat.id]: (e.target as HTMLInputElement).files?.[0] ?? null }; }}
										class="block mt-1 text-xs text-gray-300" />
								</label>
								<label class="text-xs text-gray-400">
									{tFn('amusic.cover_optional')}
									<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
										onchange={(e) => { newTrackImage = { ...newTrackImage, [cat.id]: (e.target as HTMLInputElement).files?.[0] ?? null }; }}
										class="block mt-1 text-xs text-gray-300" />
								</label>
							</div>
							<button type="button" onclick={() => addTrack(cat)}
								disabled={busy === `add-track-${cat.id}` || !(newTrackTitle[cat.id] ?? '').trim() || !newTrackAudio[cat.id]}
								class="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
								{busy === `add-track-${cat.id}` ? tFn('amusic.uploading') : tFn('amusic.add_track')}
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
