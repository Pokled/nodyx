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
		position: number;
	}
	interface Track {
		id: string; category_id: string; title: string; description: string | null;
		audio_url: string; image_url: string | null; position: number;
	}
	interface Settings { title: string | null; subtitle: string | null; banner_url: string | null; }

	let categories  = $state<Category[]>(data.categories ?? []);
	let tracksByCat = $state<Record<string, Track[]>>({});
	let openCat     = $state<string | null>(null);
	let busy        = $state<string | null>(null); // clé de l'opération en cours (feedback UI)
	let errorMsg    = $state<string | null>(null);
	let settings    = $state<Settings>(data.settings ?? { title: null, subtitle: null, banner_url: null });
	let bannerInput = $state<HTMLInputElement | null>(null);

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

	async function patchSettings(patch: { title?: string | null; subtitle?: string | null; banner_asset_id?: string | null }) {
		const json = await api('/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		});
		settings = json.settings;
	}

	async function updateSettingsText(patch: { title?: string | null; subtitle?: string | null }) {
		busy = 'settings';
		errorMsg = null;
		try {
			await patchSettings(patch);
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function changeBanner(file: File) {
		busy = 'settings-banner';
		errorMsg = null;
		try {
			const { asset_id } = await uploadFile('image', file);
			await patchSettings({ banner_asset_id: asset_id });
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
	}

	async function removeBanner() {
		busy = 'settings-banner';
		errorMsg = null;
		try {
			await patchSettings({ banner_asset_id: null });
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			busy = null;
		}
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

	async function moveCategory(index: number, direction: -1 | 1) {
		const otherIndex = index + direction;
		if (otherIndex < 0 || otherIndex >= categories.length) return;
		const a = categories[index];
		const b = categories[otherIndex];
		busy = `reorder-category-${a.id}`;
		errorMsg = null;
		try {
			await api(`/categories/${a.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position: b.position }),
			});
			await api(`/categories/${b.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position: a.position }),
			});
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

	async function moveTrack(cat: Category, index: number, direction: -1 | 1) {
		const list = tracksByCat[cat.id];
		if (!list) return;
		const otherIndex = index + direction;
		if (otherIndex < 0 || otherIndex >= list.length) return;
		const a = list[index];
		const b = list[otherIndex];
		busy = `reorder-track-${a.id}`;
		errorMsg = null;
		try {
			await api(`/tracks/${a.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position: b.position }),
			});
			await api(`/tracks/${b.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position: a.position }),
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

	// ── Modération des commentaires (lecture publique, suppression admin) ──
	interface Comment { id: string; author_name: string; body: string; created_at: string }
	let openTrackComments = $state<Set<string>>(new Set());
	let trackComments     = $state<Record<string, Comment[]>>({});

	function formatCommentDate(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
	}

	async function toggleTrackComments(track: Track) {
		const next = new Set(openTrackComments);
		if (next.has(track.id)) {
			next.delete(track.id);
			openTrackComments = next;
			return;
		}
		next.add(track.id);
		openTrackComments = next;
		if (!trackComments[track.id]) {
			const json = await api(`/tracks/${track.id}/comments`);
			trackComments = { ...trackComments, [track.id]: json.comments };
		}
	}

	async function deleteComment(track: Track, commentId: string) {
		busy = `delete-comment-${commentId}`;
		errorMsg = null;
		try {
			await api(`/comments/${commentId}`, { method: 'DELETE' });
			trackComments = { ...trackComments, [track.id]: (trackComments[track.id] ?? []).filter(c => c.id !== commentId) };
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

	<!-- Page publique : titre, sous-titre, bannière -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none">
			{tFn('amusic.page_settings')}
		</summary>
		<div class="px-5 pb-5 pt-3 border-t border-gray-800 space-y-3">
			<div>
				<label for="page-title" class="block text-xs text-gray-400 mb-1">{tFn('amusic.field_title')}</label>
				<input id="page-title" type="text" value={settings.title ?? ''} maxlength="120"
					placeholder={tFn('music.title')}
					onblur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v !== (settings.title ?? '')) updateSettingsText({ title: v || null }); }}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
			</div>
			<div>
				<label for="page-subtitle" class="block text-xs text-gray-400 mb-1">{tFn('amusic.field_subtitle')}</label>
				<textarea id="page-subtitle" rows="2" maxlength="300"
					placeholder={tFn('music.subtitle')}
					onblur={(e) => { const v = (e.target as HTMLTextAreaElement).value.trim(); if (v !== (settings.subtitle ?? '')) updateSettingsText({ subtitle: v || null }); }}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">{settings.subtitle ?? ''}</textarea>
			</div>
			<div>
				<p class="block text-xs text-gray-400 mb-1">{tFn('amusic.field_banner')}</p>
				{#if settings.banner_url}
					<div class="relative w-full max-w-md rounded-lg overflow-hidden border border-gray-700">
						<img src={settings.banner_url} alt="" class="w-full h-28 object-cover" />
						<button type="button" onclick={removeBanner} disabled={busy === 'settings-banner'}
							class="mus-btn-danger mus-banner-remove" aria-label={tFn('amusic.remove_banner')} title={tFn('amusic.remove_banner')}>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				{:else}
					<input bind:this={bannerInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"
						onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) changeBanner(f); (e.target as HTMLInputElement).value = ''; }} />
					<button type="button" onclick={() => bannerInput?.click()} disabled={busy === 'settings-banner'} class="mus-btn-file">
						{busy === 'settings-banner' ? tFn('common.loading') : tFn('amusic.upload_banner')}
					</button>
				{/if}
			</div>
		</div>
	</details>

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
		{#each categories as cat, catIndex (cat.id)}
			<div class="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
				<div class="flex items-center gap-4 p-4">
					<div class="mus-reorder shrink-0">
						<button type="button" onclick={() => moveCategory(catIndex, -1)} disabled={catIndex === 0}
							class="mus-btn-move" aria-label={tFn('amusic.move_up')} title={tFn('amusic.move_up')}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
							</svg>
						</button>
						<button type="button" onclick={() => moveCategory(catIndex, 1)} disabled={catIndex === categories.length - 1}
							class="mus-btn-move" aria-label={tFn('amusic.move_down')} title={tFn('amusic.move_down')}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
					</div>
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
							{#each tracksByCat[cat.id] as track, trackIndex (track.id)}
								<div class="mus-track-row rounded-lg bg-gray-900/50 border border-gray-800 p-2.5">
								<div class="flex items-center gap-3">
									<div class="mus-reorder mus-reorder--tight shrink-0">
										<button type="button" onclick={() => moveTrack(cat, trackIndex, -1)} disabled={trackIndex === 0}
											class="mus-btn-move" aria-label={tFn('amusic.move_up')} title={tFn('amusic.move_up')}>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
											</svg>
										</button>
										<button type="button" onclick={() => moveTrack(cat, trackIndex, 1)} disabled={trackIndex === (tracksByCat[cat.id]?.length ?? 0) - 1}
											class="mus-btn-move" aria-label={tFn('amusic.move_down')} title={tFn('amusic.move_down')}>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
											</svg>
										</button>
									</div>
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
									<button type="button" onclick={() => toggleTrackComments(track)}
										class="mus-btn-ghost shrink-0" title={tFn('music.comments')}>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
										</svg>
										{#if trackComments[track.id]?.length}{trackComments[track.id].length}{/if}
									</button>
									<button type="button" onclick={() => deleteTrack(cat, track)} disabled={busy === `delete-track-${track.id}`}
										class="mus-btn-danger shrink-0" aria-label={tFn('common.delete')} title={tFn('common.delete')}>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
										</svg>
									</button>
								</div>

								{#if openTrackComments.has(track.id)}
									<div class="mt-2 pt-2 border-t border-gray-800 space-y-2">
										{#if trackComments[track.id]}
											{#each trackComments[track.id] as comment (comment.id)}
												<div class="flex items-start justify-between gap-2">
													<div class="min-w-0">
														<p class="text-xs">
															<span class="font-semibold text-white">{comment.author_name}</span>
															<span class="text-gray-500 ml-1">{formatCommentDate(comment.created_at)}</span>
														</p>
														<p class="text-xs text-gray-400">{comment.body}</p>
													</div>
													<button type="button" onclick={() => deleteComment(track, comment.id)}
														disabled={busy === `delete-comment-${comment.id}`}
														class="mus-btn-danger shrink-0" aria-label={tFn('common.delete')} title={tFn('common.delete')}>
														<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
														</svg>
													</button>
												</div>
											{:else}
												<p class="text-xs text-gray-500 italic">{tFn('music.no_comments')}</p>
											{/each}
										{/if}
									</div>
								{/if}
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

	.mus-reorder {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mus-reorder--tight { gap: 0; }

	.mus-btn-move {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 18px;
		color: rgba(255, 255, 255, 0.35);
		background: none;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.mus-btn-move:hover:not(:disabled) { color: #a5b4fc; background: rgba(99, 102, 241, 0.1); }
	.mus-btn-move:disabled { opacity: 0.2; cursor: default; }

	.mus-banner-remove {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0, 0, 0, 0.55);
	}
	.mus-banner-remove:hover { background: rgba(0, 0, 0, 0.75); }
</style>
