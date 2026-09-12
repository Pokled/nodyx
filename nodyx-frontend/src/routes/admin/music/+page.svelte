<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);
	const token = $derived((page.data as any).token as string);

	let { data }: { data: PageData } = $props();

	interface Category {
		id: string; slug: string; title: string; description: string | null;
		license_note: string | null; image_url: string | null; track_count: number;
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

	async function updateCategoryLicense(cat: Category, licenseNote: string) {
		busy = `license-category-${cat.id}`;
		errorMsg = null;
		try {
			await api(`/categories/${cat.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ license_note: licenseNote || null }),
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

	// Refs vers les <input type="file"> cachés (un par catégorie ouverte) :
	// on ouvre le sélecteur nous-mêmes via .click(), plutôt que de compter sur
	// le rendu natif du bouton de fichier (minuscule et peu visible sur fond
	// sombre, cf gotcha rencontré le 12/09 : Jonathan ne le voyait pas).
	let coverInputRefs = $state<Record<string, HTMLInputElement | null>>({});
	let audioInputRefs = $state<Record<string, HTMLInputElement | null>>({});
	let imageInputRefs = $state<Record<string, HTMLInputElement | null>>({});

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

	async function updateTrackText(cat: Category, track: Track, title: string, description: string) {
		busy = `update-track-${track.id}`;
		errorMsg = null;
		try {
			await api(`/tracks/${track.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, description: description || null }),
			});
			await refreshTracks(cat.id, cat.slug);
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
		<a href="/musique" target="_blank" class="mus-link-btn">
			{tFn('amusic.view_public')}
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
			</svg>
		</a>
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
				class="mus-btn-primary">
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
					<button type="button"
						class="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-800 cursor-pointer group"
						title={tFn('amusic.change_image')}
						onclick={() => coverInputRefs[cat.id]?.click()}>
						{#if cat.image_url}
							<img src={cat.image_url} alt="" class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full flex items-center justify-center text-gray-600 text-xs text-center px-1">{tFn('amusic.no_image')}</div>
						{/if}
						<div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white transition-opacity">
							{busy === `image-category-${cat.id}` ? tFn('common.loading') : tFn('amusic.change_image')}
						</div>
						<input bind:this={coverInputRefs[cat.id]} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"
							onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) changeCategoryImage(cat, f); (e.target as HTMLInputElement).value = ''; }} />
					</button>

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

					<button type="button" onclick={() => toggleCategory(cat)} class="mus-btn-ghost shrink-0">
						{openCat === cat.id ? tFn('amusic.collapse') : tFn('amusic.manage_tracks')}
						<svg class="w-3.5 h-3.5 transition-transform" class:mus-rotate={openCat === cat.id} fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					<button type="button" onclick={() => deleteCategory(cat)} disabled={busy === `delete-category-${cat.id}`}
						class="mus-btn-danger shrink-0" aria-label={tFn('common.delete')} title={tFn('common.delete')}>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
						</svg>
					</button>
				</div>

				{#if openCat === cat.id}
					<div class="border-t border-gray-800 p-4 space-y-3 bg-gray-950/40">
						<div class="rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<p class="text-xs font-semibold text-indigo-300">{tFn('amusic.license_note')}</p>
								{#if cat.license_note}
									<a href={`/api/v1/music/categories/${cat.id}/license.pdf`} class="mus-link-btn">
										{tFn('amusic.download_license')}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
										</svg>
									</a>
								{/if}
							</div>
							<p class="text-[11px] text-gray-500">{tFn('amusic.license_note_help')}</p>
							<textarea
								value={cat.license_note ?? ''}
								rows="3"
								placeholder={tFn('amusic.license_note_ph')}
								onblur={(e) => { const v = (e.target as HTMLTextAreaElement).value.trim(); if (v !== (cat.license_note ?? '')) updateCategoryLicense(cat, v); }}
								class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500"
							></textarea>
						</div>

						{#if tracksByCat[cat.id]}
							{#each tracksByCat[cat.id] as track (track.id)}
								<div class="mus-track-row flex items-center gap-3 rounded-lg bg-gray-900/50 border border-gray-800 p-2.5">
									{#if track.image_url}
										<img src={track.image_url} alt="" class="w-10 h-10 rounded object-cover shrink-0" />
									{/if}
									<div class="flex-1 min-w-0 space-y-1">
										<input type="text" value={track.title} maxlength="150"
											onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== track.title) updateTrackText(cat, track, v, track.description ?? ''); }}
											class="w-full bg-transparent text-sm text-white font-medium focus:outline-none focus:border-b focus:border-indigo-500" />
										<input type="text" value={track.description ?? ''} maxlength="500"
											placeholder={tFn('amusic.field_description')}
											onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v !== (track.description ?? '')) updateTrackText(cat, track, track.title, v); }}
											class="w-full bg-transparent text-xs text-gray-500 focus:outline-none focus:border-b focus:border-indigo-500" />
										<audio src={track.audio_url} controls class="w-full h-8 mt-1"></audio>
									</div>
									<button type="button" onclick={() => deleteTrack(cat, track)} disabled={busy === `delete-track-${track.id}`}
										class="mus-btn-danger shrink-0" aria-label={tFn('common.delete')} title={tFn('common.delete')}>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
										</svg>
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
								<input bind:this={audioInputRefs[cat.id]} type="file"
									accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/flac,audio/x-m4a" class="hidden"
									onchange={(e) => { newTrackAudio = { ...newTrackAudio, [cat.id]: (e.target as HTMLInputElement).files?.[0] ?? null }; }} />
								<button type="button" onclick={() => audioInputRefs[cat.id]?.click()} class="mus-btn-file">
									<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
									</svg>
									<span class="truncate max-w-[14ch]">{newTrackAudio[cat.id]?.name ?? tFn('amusic.audio_file')}</span>
								</button>

								<input bind:this={imageInputRefs[cat.id]} type="file"
									accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"
									onchange={(e) => { newTrackImage = { ...newTrackImage, [cat.id]: (e.target as HTMLInputElement).files?.[0] ?? null }; }} />
								<button type="button" onclick={() => imageInputRefs[cat.id]?.click()} class="mus-btn-file">
									<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
									</svg>
									<span class="truncate max-w-[14ch]">{newTrackImage[cat.id]?.name ?? tFn('amusic.cover_optional')}</span>
								</button>
							</div>
							<button type="button" onclick={() => addTrack(cat)}
								disabled={busy === `add-track-${cat.id}` || !(newTrackTitle[cat.id] ?? '').trim() || !newTrackAudio[cat.id]}
								class="mus-btn-primary">
								{busy === `add-track-${cat.id}` ? tFn('amusic.uploading') : tFn('amusic.add_track')}
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.mus-link-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		color: #818cf8;
		text-decoration: none;
		transition: color 0.15s;
	}
	.mus-link-btn:hover { color: #a5b4fc; }

	.mus-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		color: #818cf8;
		background: none;
		border: none;
		padding: 5px 8px;
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.mus-btn-ghost:hover { color: #a5b4fc; background: rgba(99, 102, 241, 0.08); }

	.mus-rotate { transform: rotate(180deg); }

	.mus-btn-danger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgba(255, 255, 255, 0.3);
		background: none;
		border: none;
		padding: 6px;
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.mus-btn-danger:hover { color: #f87171; background: rgba(248, 113, 113, 0.08); }
	.mus-btn-danger:disabled { opacity: 0.4; cursor: default; }

	.mus-btn-file {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: 8px;
		border: 1px solid #374151;
		background: #1f2937;
		padding: 7px 12px;
		font-size: 0.75rem;
		color: #d1d5db;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.mus-btn-file:hover { border-color: #6366f1; background: #24304d; }

	.mus-btn-primary {
		border-radius: 8px;
		background: #4f46e5;
		border: none;
		padding: 9px 18px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
	}
	.mus-btn-primary:hover:not(:disabled) {
		background: #6366f1;
		transform: translateY(-1px);
		box-shadow: 0 6px 16px -4px rgba(99, 102, 241, 0.5);
	}
	.mus-btn-primary:active:not(:disabled) { transform: translateY(0); }
	.mus-btn-primary:disabled { opacity: 0.5; cursor: default; }

	.mus-track-row {
		transition: background 0.15s, border-color 0.15s;
	}
	.mus-track-row:hover {
		border-color: #374151;
		background: rgba(255, 255, 255, 0.03);
	}
</style>
