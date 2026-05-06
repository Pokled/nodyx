<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Types ────────────────────────────────────────────────────────────────
	interface BackupRow {
		id:              string;
		filename:        string;
		size_bytes:      number;
		nodyx_version:   string;
		format_version:  number;
		contents:        { db: boolean; uploads: boolean; config: boolean };
		stats:           Record<string, number>;
		label:           string | null;
		encrypted:       boolean;
		checksum:        string;
		created_at:      string;
		created_by:      string | null;
		source:          'manual' | 'scheduled' | 'pre-restore';
		protected:       boolean;
		expires_at:      string | null;
	}
	interface DiffPreview {
		current: Record<string, number>;
		backup:  Record<string, number>;
		delta:   Record<string, number>;
	}

	// ── State ────────────────────────────────────────────────────────────────
	let backups   = $state<BackupRow[]>(data.backups as BackupRow[]);
	let storage   = $state(data.storage);
	let total     = $state<number>(data.total);

	let creating  = $state(false);
	let createOpen = $state(false);
	let createLabel = $state('');
	let createIncludeUploads = $state(true);

	let restoreFor    = $state<BackupRow | null>(null);
	let restoreSlug   = $state('');
	let restoreDiff   = $state<DiffPreview | null>(null);
	let restoreCountdown = $state(5);
	let restoring     = $state(false);
	let restoreCountdownTimer: ReturnType<typeof setInterval> | null = null;

	let verifyingId = $state<string | null>(null);
	let verifyResults = $state<Record<string, { ok: boolean; errors: string[] }>>({});

	// Toasts
	let toasts = $state<{ id: number; text: string; ok: boolean }[]>([]);
	let toastId = 0;
	function toast(text: string, ok = true) {
		const id = ++toastId;
		toasts = [...toasts, { id, text, ok }];
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id); }, 3500);
	}

	function getToken() { return ($page.data as any).token as string ?? ''; }

	// ── Helpers ──────────────────────────────────────────────────────────────
	function fmtBytes(n: number): string {
		if (n < 1024)             return `${n} B`;
		if (n < 1024 ** 2)        return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 ** 3)        return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return                       `${(n / 1024 ** 3).toFixed(2)} GB`;
	}
	function fmtDate(s: string): string {
		const d = new Date(s);
		return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
	}
	function fmtRelative(s: string): string {
		const d = new Date(s);
		const diff = Date.now() - d.getTime();
		const m = Math.floor(diff / 60000);
		if (m < 1)   return 'à l\'instant';
		if (m < 60)  return `il y a ${m} min`;
		const h = Math.floor(m / 60);
		if (h < 24)  return `il y a ${h} h`;
		const d2 = Math.floor(h / 24);
		return `il y a ${d2} j`;
	}
	function sourceLabel(s: string): string {
		return s === 'manual' ? 'Manuel' : s === 'scheduled' ? 'Auto' : 'Pré-restore';
	}
	function sourceColor(s: string): string {
		return s === 'manual' ? '#a78bfa' : s === 'scheduled' ? '#06b6d4' : '#fb923c';
	}

	// ── Refresh ──────────────────────────────────────────────────────────────
	async function refresh() {
		const [list, store] = await Promise.all([
			fetch('/api/v1/admin/backups?limit=50', { headers: { Authorization: `Bearer ${getToken()}` } }),
			fetch('/api/v1/admin/backups/storage',  { headers: { Authorization: `Bearer ${getToken()}` } }),
		]);
		if (list.ok) {
			const j = await list.json();
			backups = j.rows ?? [];
			total   = j.total ?? 0;
		}
		if (store.ok) storage = await store.json();
	}

	// ── Create ───────────────────────────────────────────────────────────────
	async function handleCreate() {
		creating = true;
		try {
			const res = await fetch('/api/v1/admin/backups', {
				method: 'POST',
				headers: {
					'Content-Type':  'application/json',
					Authorization:   `Bearer ${getToken()}`,
				},
				body: JSON.stringify({
					include_uploads: createIncludeUploads,
					label:           createLabel.trim() || undefined,
				}),
			});
			if (res.ok) {
				toast('Sauvegarde créée');
				createOpen = false;
				createLabel = '';
				createIncludeUploads = true;
				await refresh();
			} else {
				const j = await res.json().catch(() => ({}));
				toast(j.error ?? `Erreur ${res.status}`, false);
			}
		} catch (e) {
			toast(`Erreur : ${(e as Error).message}`, false);
		} finally {
			creating = false;
		}
	}

	// ── Download ─────────────────────────────────────────────────────────────
	async function handleDownload(b: BackupRow) {
		// We trigger a normal navigation so the browser handles the stream as
		// a file download. The Authorization header can't be added on a plain
		// <a> click, so we fetch + blob + anchor click.
		const res = await fetch(`/api/v1/admin/backups/${b.id}/download`, {
			headers: { Authorization: `Bearer ${getToken()}` },
		});
		if (!res.ok) { toast('Téléchargement échoué', false); return; }
		const blob = await res.blob();
		const url  = URL.createObjectURL(blob);
		const a    = document.createElement('a');
		a.href     = url;
		a.download = b.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast('Téléchargement lancé');
	}

	// ── Verify ───────────────────────────────────────────────────────────────
	async function handleVerify(b: BackupRow) {
		verifyingId = b.id;
		try {
			const res = await fetch(`/api/v1/admin/backups/${b.id}/verify`, {
				method:  'POST',
				headers: { Authorization: `Bearer ${getToken()}` },
			});
			if (res.ok) {
				const j = await res.json();
				verifyResults[b.id] = j;
				toast(j.ok ? 'Sauvegarde vérifiée — intégrité OK' : 'Vérification échouée', j.ok);
			} else {
				toast('Erreur vérification', false);
			}
		} finally {
			verifyingId = null;
		}
	}

	// ── Delete ───────────────────────────────────────────────────────────────
	async function handleDelete(b: BackupRow) {
		if (!confirm(`Supprimer définitivement la sauvegarde "${b.filename}" ?`)) return;
		const res = await fetch(`/api/v1/admin/backups/${b.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${getToken()}` },
		});
		if (res.ok) {
			toast('Sauvegarde supprimée');
			await refresh();
		} else {
			const j = await res.json().catch(() => ({}));
			toast(j.error ?? 'Erreur suppression', false);
		}
	}

	// ── Restore (open modal + load diff) ─────────────────────────────────────
	async function openRestore(b: BackupRow) {
		restoreFor       = b;
		restoreSlug      = '';
		restoreCountdown = 5;
		restoreDiff      = null;

		const res = await fetch(`/api/v1/admin/backups/${b.id}/diff`, {
			headers: { Authorization: `Bearer ${getToken()}` },
		});
		if (res.ok) restoreDiff = await res.json();
	}
	function closeRestore() {
		restoreFor = null;
		if (restoreCountdownTimer) {
			clearInterval(restoreCountdownTimer);
			restoreCountdownTimer = null;
		}
	}
	$effect(() => {
		// Start the 5s server-side-aligned countdown only when slug matches
		if (restoreFor && restoreSlug.trim().toLowerCase() === data.instanceSlug.toLowerCase()) {
			if (!restoreCountdownTimer && restoreCountdown > 0) {
				restoreCountdownTimer = setInterval(() => {
					restoreCountdown--;
					if (restoreCountdown <= 0 && restoreCountdownTimer) {
						clearInterval(restoreCountdownTimer);
						restoreCountdownTimer = null;
					}
				}, 1000);
			}
		} else {
			if (restoreCountdownTimer) {
				clearInterval(restoreCountdownTimer);
				restoreCountdownTimer = null;
			}
			restoreCountdown = 5;
		}
	});

	async function handleRestore() {
		if (!restoreFor) return;
		restoring = true;
		try {
			const res = await fetch(`/api/v1/admin/backups/${restoreFor.id}/restore`, {
				method:  'POST',
				headers: {
					'Content-Type':  'application/json',
					Authorization:   `Bearer ${getToken()}`,
				},
				body: JSON.stringify({ confirm_slug: restoreSlug, dry_run: false }),
			});
			if (res.ok) {
				toast('Restauration terminée. Tu as été déconnecté.');
				// Sessions are flushed on the server, redirect to login
				setTimeout(() => { window.location.href = '/auth/login'; }, 2000);
			} else {
				const j = await res.json().catch(() => ({}));
				toast(j.error ?? 'Erreur restauration', false);
				restoring = false;
			}
		} catch (e) {
			toast(`Erreur : ${(e as Error).message}`, false);
			restoring = false;
		}
	}
</script>

<svelte:head><title>Sauvegardes — Admin</title></svelte:head>

<!-- Toasts -->
<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as t (t.id)}
		<div class="px-4 py-2.5 text-sm font-medium text-white pointer-events-auto"
		     style="background:{t.ok ? '#166534' : '#7f1d1d'}; border:1px solid {t.ok ? '#16a34a' : '#dc2626'}">
			{t.text}
		</div>
	{/each}
</div>

<div class="min-h-screen p-6" style="background:#05050a; color:#e2e8f0">

	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-black" style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#a78bfa,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text">
				Sauvegardes & Restauration
			</h1>
			<p class="text-sm mt-1" style="color:#6b7280">
				Crée des points de restauration de ton instance. Chaque sauvegarde contient la base, les uploads et la config.
			</p>
		</div>
		<a href="/admin/backups/audit"
		   class="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider transition-all"
		   style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:#9ca3af">
			Journal d'audit →
		</a>
	</div>

	<!-- Storage indicator -->
	<div class="mb-4 px-4 py-3 flex items-center justify-between" style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
		<div class="flex items-center gap-3">
			<span class="text-base">💾</span>
			<div>
				<p class="text-xs" style="color:#6b7280">Espace utilisé par les sauvegardes</p>
				<p class="text-sm font-bold">
					{fmtBytes(storage.used)}
					<span class="font-normal" style="color:#6b7280">
						/ {fmtBytes(storage.available)} libre{(storage.available > 1) ? 's' : ''}
					</span>
				</p>
			</div>
		</div>
		<div class="text-xs text-right">
			<p style="color:#6b7280">Sauvegardes en stock</p>
			<p class="font-bold">{total}</p>
		</div>
	</div>

	<!-- Action bar -->
	<div class="mb-4 flex items-center gap-3">
		<button
			onclick={() => createOpen = true}
			class="flex items-center gap-2 px-4 py-2 text-sm font-bold transition-all"
			style="background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.4); color:#a78bfa">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m-8-8h16"/>
			</svg>
			Créer une sauvegarde
		</button>
	</div>

	<!-- Backups table -->
	<div style="background:#0d0d12; border:1px solid rgba(255,255,255,.07)">
		<div class="px-4 py-3 flex items-center gap-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
			<span class="text-base">📦</span>
			<span class="font-bold text-sm">Sauvegardes existantes</span>
			<span class="ml-auto text-xs" style="color:#374151">{backups.length}</span>
		</div>

		{#if backups.length === 0}
			<div class="px-4 py-12 text-center text-sm" style="color:#374151">
				Aucune sauvegarde pour l'instant. Crée la première avec le bouton ci-dessus.
			</div>
		{:else}
			<div class="divide-y" style="border-color:rgba(255,255,255,.04)">
				{#each backups as b (b.id)}
					{@const verify = verifyResults[b.id]}
					<div class="px-4 py-3 flex items-center gap-3" class:opacity-70={b.protected}>
						<span class="text-lg shrink-0">
							{b.protected ? '🔒' : b.encrypted ? '🔐' : '📦'}
						</span>

						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-mono truncate" style="color:#e2e8f0">{b.filename}</span>
								<span class="text-[9px] font-bold uppercase px-1.5 py-0.5"
								      style="background:rgba({sourceColor(b.source) === '#a78bfa' ? '167,139,250' : sourceColor(b.source) === '#06b6d4' ? '6,182,212' : '251,146,60'},.1); border:1px solid rgba({sourceColor(b.source) === '#a78bfa' ? '167,139,250' : sourceColor(b.source) === '#06b6d4' ? '6,182,212' : '251,146,60'},.25); color:{sourceColor(b.source)}">
									{sourceLabel(b.source)}
								</span>
								{#if verify}
									<span class="text-[9px] font-bold uppercase px-1.5 py-0.5"
									      style="background:rgba({verify.ok ? '74,222,128' : '239,68,68'},.1); border:1px solid rgba({verify.ok ? '74,222,128' : '239,68,68'},.25); color:{verify.ok ? '#4ade80' : '#ef4444'}">
										{verify.ok ? '✓ Vérifié' : '✗ Erreur'}
									</span>
								{/if}
							</div>
							<div class="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style="color:#6b7280">
								<span>{fmtBytes(b.size_bytes)}</span>
								<span>·</span>
								<span title={fmtDate(b.created_at)}>{fmtRelative(b.created_at)}</span>
								<span>·</span>
								<span>v{b.nodyx_version}</span>
								{#if b.contents.uploads}
									<span>·</span><span>+ uploads</span>
								{/if}
								{#if b.label}
									<span>·</span><span class="italic">"{b.label}"</span>
								{/if}
								{#if b.expires_at}
									<span>·</span><span style="color:#fb923c">Protégée jusqu'au {fmtDate(b.expires_at)}</span>
								{/if}
							</div>
						</div>

						<div class="flex items-center gap-1 shrink-0">
							<button onclick={() => handleDownload(b)}
							        class="px-2.5 py-1.5 text-xs font-bold transition-colors"
							        style="border:1px solid rgba(255,255,255,.08); color:#9ca3af"
							        title="Télécharger">
								↓
							</button>
							<button onclick={() => handleVerify(b)} disabled={verifyingId === b.id}
							        class="px-2.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
							        style="border:1px solid rgba(255,255,255,.08); color:#9ca3af"
							        title="Vérifier l'intégrité">
								{verifyingId === b.id ? '…' : '✓'}
							</button>
							{#if !b.protected}
								<button onclick={() => openRestore(b)}
								        class="px-2.5 py-1.5 text-xs font-bold transition-colors"
								        style="background:rgba(251,146,60,.08); border:1px solid rgba(251,146,60,.2); color:#fb923c"
								        title="Restaurer">
									↻
								</button>
							{/if}
							<button onclick={() => handleDelete(b)} disabled={b.protected}
							        class="px-2.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-30"
							        style="border:1px solid rgba(239,68,68,.2); color:#ef4444"
							        title={b.protected ? 'Sauvegarde protégée' : 'Supprimer'}>
								✕
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- ── Modal: create ──────────────────────────────────────────────────────── -->
{#if createOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4"
	     style="background:rgba(0,0,0,.75); backdrop-filter:blur(4px)"
	     role="presentation"
	     onclick={(e) => { if (e.target === e.currentTarget) createOpen = false }}
	     onkeydown={(e) => { if (e.key === 'Escape') createOpen = false }}>
		<div class="w-full max-w-md flex flex-col"
		     role="dialog" aria-modal="true" tabindex="-1"
		     style="background:#0d0d12; border:1px solid rgba(255,255,255,.1)">
			<div class="px-5 py-4" style="border-bottom:1px solid rgba(255,255,255,.06)">
				<p class="font-bold text-sm">Créer une sauvegarde</p>
			</div>
			<div class="p-5 flex flex-col gap-4">
				<label class="flex flex-col gap-1.5">
					<span class="text-xs font-bold uppercase tracking-wider" style="color:#9ca3af">Libellé (optionnel)</span>
					<input type="text" bind:value={createLabel} maxlength="200"
					       placeholder="ex: avant migration v2.4"
					       class="px-3 py-2 text-sm"
					       style="background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); color:#e2e8f0" />
					<span class="text-[10px]" style="color:#6b7280">Pour t'aider à reconnaître cette sauvegarde plus tard.</span>
				</label>

				<label class="flex items-start gap-2.5 cursor-pointer">
					<input type="checkbox" bind:checked={createIncludeUploads}
					       class="mt-0.5"
					       style="accent-color:#a78bfa" />
					<div class="flex flex-col">
						<span class="text-sm font-bold">Inclure les fichiers uploadés</span>
						<span class="text-[10px]" style="color:#6b7280">Avatars, images, documents. Décocher = sauvegarde DB-only (plus rapide, beaucoup moins lourde).</span>
					</div>
				</label>

				<div class="px-3 py-2 text-[11px] leading-relaxed" style="background:rgba(167,139,250,.05); border:1px solid rgba(167,139,250,.15); color:#9ca3af">
					ℹ La création peut prendre plusieurs minutes selon le volume. La page reste bloquée pendant l'opération en Phase 1 — on ajoutera une barre de progression Socket.IO en Phase 2.
				</div>
			</div>
			<div class="px-5 py-3 flex items-center justify-end gap-2" style="border-top:1px solid rgba(255,255,255,.06)">
				<button onclick={() => createOpen = false} disabled={creating}
				        class="px-4 py-1.5 text-xs font-bold disabled:opacity-50"
				        style="border:1px solid rgba(255,255,255,.08); color:#9ca3af">
					Annuler
				</button>
				<button onclick={handleCreate} disabled={creating}
				        class="px-4 py-1.5 text-xs font-bold disabled:opacity-50"
				        style="background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.4); color:#a78bfa">
					{creating ? 'Création...' : 'Créer'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Modal: restore ─────────────────────────────────────────────────────── -->
{#if restoreFor}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4"
	     style="background:rgba(0,0,0,.85); backdrop-filter:blur(6px)"
	     role="presentation"
	     onclick={(e) => { if (e.target === e.currentTarget && !restoring) closeRestore() }}
	     onkeydown={(e) => { if (e.key === 'Escape' && !restoring) closeRestore() }}>
		<div class="w-full max-w-xl flex flex-col"
		     role="dialog" aria-modal="true" tabindex="-1"
		     style="background:#0d0d12; border:1px solid rgba(239,68,68,.4); box-shadow:0 0 60px rgba(239,68,68,.15)">

			<div class="px-5 py-4 flex items-center gap-3" style="border-bottom:1px solid rgba(239,68,68,.2); background:rgba(239,68,68,.05)">
				<span class="text-xl">⚠</span>
				<div>
					<p class="font-bold text-sm" style="color:#fca5a5">Restaurer cette sauvegarde ?</p>
					<p class="text-[10px] mt-0.5" style="color:#9ca3af">Action irréversible — toutes les données actuelles seront remplacées.</p>
				</div>
			</div>

			<div class="p-5 flex flex-col gap-4">
				<div class="text-[11px] leading-relaxed" style="color:#9ca3af">
					Sauvegarde du <strong style="color:#e2e8f0">{fmtDate(restoreFor.created_at)}</strong> · {fmtBytes(restoreFor.size_bytes)} · v{restoreFor.nodyx_version}
					{#if restoreFor.label}
						<br/><span class="italic">"{restoreFor.label}"</span>
					{/if}
				</div>

				{#if restoreDiff}
					{@const dd = restoreDiff.delta}
					<div class="px-3 py-2.5" style="background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06)">
						<p class="text-[10px] font-bold uppercase tracking-wider mb-2" style="color:#9ca3af">Ce que tu vas perdre depuis cette sauvegarde</p>
						<div class="grid grid-cols-2 gap-2 text-xs">
							{#each [
								{ label: 'Fils de discussion', delta: dd.threads,        bytes: false },
								{ label: 'Posts',              delta: dd.posts,          bytes: false },
								{ label: 'Messages chat',      delta: dd.messages,       bytes: false },
								{ label: 'Utilisateurs',       delta: dd.users,          bytes: false },
								{ label: 'Fichiers uploadés',  delta: dd.uploads_count,  bytes: false },
								{ label: 'Octets uploadés',    delta: dd.uploads_bytes,  bytes: true  },
							] as line}
								<div class="flex items-center gap-2">
									<span class="text-[10px]" style="color:#6b7280">{line.label}</span>
									<span class="text-xs font-mono" style="color:{line.delta > 0 ? '#fca5a5' : line.delta < 0 ? '#86efac' : '#6b7280'}">
										{line.delta > 0 ? '+' : ''}{line.bytes ? fmtBytes(Math.abs(line.delta)) : line.delta}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="px-3 py-2 text-[11px] leading-relaxed" style="background:rgba(74,222,128,.05); border:1px solid rgba(74,222,128,.15); color:#86efac">
					✓ Une sauvegarde de l'état actuel sera créée automatiquement avant le restore (protégée 24h).
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="text-xs font-bold uppercase tracking-wider" style="color:#9ca3af">
						Pour confirmer, tape le slug de ton instance :
						<code class="ml-1" style="color:#e2e8f0">{data.instanceSlug}</code>
					</span>
					<input type="text" bind:value={restoreSlug}
					       autocomplete="off" autocorrect="off" spellcheck="false"
					       class="px-3 py-2 text-sm font-mono"
					       style="background:rgba(255,255,255,.03); border:1px solid rgba(239,68,68,.25); color:#e2e8f0" />
				</label>
			</div>

			<div class="px-5 py-3 flex items-center justify-end gap-2" style="border-top:1px solid rgba(239,68,68,.2)">
				<button onclick={closeRestore} disabled={restoring}
				        class="px-4 py-1.5 text-xs font-bold disabled:opacity-50"
				        style="border:1px solid rgba(255,255,255,.08); color:#9ca3af">
					Annuler
				</button>
				<button
					onclick={handleRestore}
					disabled={restoring || restoreSlug.trim().toLowerCase() !== data.instanceSlug.toLowerCase() || restoreCountdown > 0}
					class="px-4 py-1.5 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
					style="background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.4); color:#fca5a5">
					{restoring ? 'Restauration...' : restoreCountdown > 0 && restoreSlug.trim().toLowerCase() === data.instanceSlug.toLowerCase() ? `Restaurer dans ${restoreCountdown}s` : 'Restaurer maintenant'}
				</button>
			</div>
		</div>
	</div>
{/if}

