<script lang="ts">
    import NetworkDoctor from '$lib/components/NetworkDoctor.svelte';
    import { page } from '$app/stores';
    import { invalidateAll } from '$app/navigation';
    import { PUBLIC_API_URL, PUBLIC_SIGNET_URL } from '$env/static/public';
    import { tick } from 'svelte';

    // ── Nexus Signet ──────────────────────────────────────────────────────────
    type SignetDevice = { id: string; label: string; created_at: string; last_used_at: string | null }

    let signetDevices     = $state<SignetDevice[]>([])
    let signetDevicesLoaded = $state(false)
    let signetToken       = $state<string | null>(null)
    let signetTokenExpiry = $state<string | null>(null)
    let signetGenerating  = $state(false)
    let signetCopied      = $state(false)
    let signetRevoking    = $state<string | null>(null)
    let signetQrCanvas    = $state<HTMLCanvasElement | null>(null)
    let signetQrLink      = $state<string | null>(null)

    async function loadSignetDevices() {
        const token = ($page.data as any).token as string | null
        if (!token) return
        try {
            const res = await fetch(`${PUBLIC_API_URL}/api/auth/devices`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (res.ok) {
                const j = await res.json()
                signetDevices = j.devices ?? []
            }
        } catch {}
        signetDevicesLoaded = true
    }

    async function generateSignetToken() {
        const token = ($page.data as any).token as string | null
        if (!token) return
        signetGenerating = true
        signetToken = null
        signetQrLink = null
        try {
            const res = await fetch(`${PUBLIC_API_URL}/api/auth/enrollment-tokens`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            })
            if (res.ok) {
                const j = await res.json()
                signetToken = j.token
                signetTokenExpiry = j.expiresAt
                signetQrLink = `${PUBLIC_SIGNET_URL}/setup?hub=${encodeURIComponent(PUBLIC_API_URL)}&token=${encodeURIComponent(j.token)}`
                // Génère le QR code après le prochain tick (canvas doit être dans le DOM)
                await tick()
                if (signetQrCanvas) {
                    const QRCode = (await import('qrcode')).default
                    await QRCode.toCanvas(signetQrCanvas, signetQrLink, {
                        width: 200, margin: 1,
                        color: { dark: '#fbbf24', light: '#0a0a0a' }
                    })
                }
            }
        } catch {}
        signetGenerating = false
    }

    async function revokeSignetDevice(deviceId: string) {
        const token = ($page.data as any).token as string | null
        if (!token) return
        signetRevoking = deviceId
        try {
            await fetch(`${PUBLIC_API_URL}/api/auth/devices/${deviceId}/admin`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            })
            signetDevices = signetDevices.filter(d => d.id !== deviceId)
        } catch {}
        signetRevoking = null
    }

    function copySignetToken() {
        if (!signetToken) return
        navigator.clipboard.writeText(signetToken)
        signetCopied = true
        setTimeout(() => signetCopied = false, 2000)
    }

    $effect(() => {
        if ($page.data.user) loadSignetDevices()
    })

    // ── Instances liées (Galaxy Bar) ──────────────────────────────────────────

    const user = $derived($page.data.user as { linked_instances?: string[] } | null);
    let linkedSlugs = $state<string[]>([]);
    $effect(() => { linkedSlugs = user?.linked_instances ?? [] });

    // Toutes les instances du directory (pour validation + noms/logos)
    const directoryInstances = $derived($page.data.directoryInstances as Array<{
        slug: string; name: string; url: string; logo_url: string | null;
    }> ?? []);

    let newSlug   = $state('');
    let slugError = $state('');
    let slugLoading = $state(false);

    async function addInstance() {
        slugError = '';
        const slug = newSlug.trim().toLowerCase();
        if (!slug) return;
        if (!/^[a-z0-9-]{1,50}$/.test(slug)) { slugError = 'Slug invalide (lettres, chiffres, tirets)'; return; }
        if (linkedSlugs.includes(slug)) { slugError = 'Déjà ajouté'; return; }
        if (!directoryInstances.find(i => i.slug === slug)) {
            slugError = 'Instance introuvable dans l\'annuaire';
            return;
        }

        slugLoading = true;
        try {
            const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/linked-instances`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$page.data.token}` },
                body: JSON.stringify({ action: 'add', slug }),
            });
            const json = await res.json();
            if (!res.ok) { slugError = json.error ?? 'Erreur'; return; }
            linkedSlugs = json.linked_instances ?? [];
            newSlug = '';
            invalidateAll();
        } finally {
            slugLoading = false;
        }
    }

    async function removeInstance(slug: string) {
        const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/linked-instances`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$page.data.token}` },
            body: JSON.stringify({ action: 'remove', slug }),
        });
        const json = await res.json();
        if (res.ok) {
            linkedSlugs = json.linked_instances ?? [];
            invalidateAll();
        }
    }
</script>

<div class="min-h-screen bg-[#050505] text-white p-8">
    <div class="max-w-2xl mx-auto space-y-12">
        <header>
            <h1 class="text-5xl font-black italic uppercase tracking-tighter mb-2">Settings</h1>
            <div class="h-1 w-20 bg-indigo-600"></div>
        </header>

        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-6">Infrastructure & Réseau</h2>
            <NetworkDoctor />
        </section>

        <!-- ── Instances liées ──────────────────────────────────────────────── -->
        {#if user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Mes instances (Galaxy Bar)</h2>
            <p class="text-xs text-gray-600 mb-6">
                Les instances sur lesquelles tu as un compte s'affichent dans la barre latérale gauche pour un accès rapide.
            </p>

            <!-- Liste des instances liées -->
            {#if linkedSlugs.length > 0}
                <div class="flex flex-col gap-2 mb-6">
                    {#each linkedSlugs as slug}
                        {@const known = directoryInstances.find(i => i.slug === slug)}
                        <div class="flex items-center justify-between gap-3 px-3 py-2.5
                                    rounded-lg border border-gray-800 bg-gray-900/60">
                            <div class="flex items-center gap-2.5">
                                <div class="w-7 h-7 rounded-lg bg-indigo-900 border border-gray-700
                                            flex items-center justify-center overflow-hidden shrink-0">
                                    {#if known?.logo_url}
                                        <img src={known.logo_url} alt={known.name} class="w-full h-full object-cover" />
                                    {:else}
                                        <span class="text-xs font-bold text-indigo-300">{slug.charAt(0).toUpperCase()}</span>
                                    {/if}
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-white">{known?.name ?? slug}</p>
                                    <p class="text-xs text-gray-600 font-mono">{known?.url ?? slug + '.nexusnode.app'}</p>
                                </div>
                            </div>
                            <button
                                onclick={() => removeInstance(slug)}
                                class="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1"
                            >
                                Retirer
                            </button>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="text-sm text-gray-600 mb-6">Aucune instance liée pour l'instant.</p>
            {/if}

            <!-- Ajouter une instance -->
            {#if directoryInstances.length > 0}
                <div class="flex gap-2">
                    <div class="flex-1 relative">
                        <input
                            list="directory-slugs"
                            type="text"
                            bind:value={newSlug}
                            placeholder="slug (ex: french-godot)"
                            onkeydown={(e) => e.key === 'Enter' && addInstance()}
                            class="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700
                                   text-sm text-gray-200 placeholder-gray-600
                                   focus:outline-none focus:border-indigo-600 transition-colors"
                        />
                        <datalist id="directory-slugs">
                            {#each directoryInstances.filter(i => !linkedSlugs.includes(i.slug)) as inst}
                                <option value={inst.slug}>{inst.name}</option>
                            {/each}
                        </datalist>
                        {#if slugError}
                            <p class="absolute -bottom-5 left-0 text-xs text-red-400">{slugError}</p>
                        {/if}
                    </div>
                    <button
                        onclick={addInstance}
                        disabled={slugLoading}
                        class="px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50
                               text-sm font-semibold text-white transition-colors"
                    >
                        {slugLoading ? '…' : 'Ajouter'}
                    </button>
                </div>
                <p class="text-xs text-gray-700 mt-7">
                    Le slug est le sous-domaine de l'instance — ex: <code class="text-indigo-500">french-godot</code> pour <code class="text-gray-500">french-godot.nexusnode.app</code>
                </p>
            {/if}
        </section>
        {/if}

        <!-- ── Nexus Signet ──────────────────────────────────────────────── -->
        {#if user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Nexus Signet</h2>
            <p class="text-xs text-gray-600 mb-6">
                Connexion sans mot de passe via votre téléphone. Clé privée ECDSA P-256 chiffrée localement — elle ne quitte jamais votre appareil.
            </p>

            <!-- Appareils enregistrés -->
            {#if signetDevicesLoaded}
                {#if signetDevices.length > 0}
                    <div class="flex flex-col gap-2 mb-6">
                        {#each signetDevices as device (device.id)}
                            <div class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                                style="background: rgba(251,191,36,0.04); border: 1px solid rgba(251,191,36,0.15)">
                                <div class="flex items-center gap-3">
                                    <span style="color: #fbbf24">◈</span>
                                    <div>
                                        <p class="text-sm font-medium text-white">{device.label}</p>
                                        <p class="text-xs text-gray-600">
                                            Enregistré le {new Date(device.created_at).toLocaleDateString('fr-FR')}
                                            {#if device.last_used_at}
                                                · Utilisé le {new Date(device.last_used_at).toLocaleDateString('fr-FR')}
                                            {/if}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onclick={() => revokeSignetDevice(device.id)}
                                    disabled={signetRevoking === device.id}
                                    class="text-xs px-2.5 py-1 rounded-lg disabled:opacity-50 transition-opacity"
                                    style="color: rgb(248,113,113); background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2)">
                                    {signetRevoking === device.id ? '…' : 'Révoquer'}
                                </button>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <p class="text-sm text-gray-600 mb-6">Aucun appareil Signet enregistré.</p>
                {/if}
            {:else}
                <p class="text-xs text-gray-700 mb-6">Chargement…</p>
            {/if}

            <!-- Générer un token d'enregistrement -->
            <div class="rounded-xl p-5" style="background: rgba(251,191,36,0.04); border: 1px solid rgba(251,191,36,0.2)">
                <div class="flex items-start justify-between gap-4 mb-3">
                    <div>
                        <p class="text-sm font-semibold text-white">Ajouter un appareil</p>
                        <p class="text-xs text-gray-500 mt-0.5">Génère un token à usage unique (15 min) à coller dans l'app Nexus Signet.</p>
                    </div>
                    <button
                        onclick={generateSignetToken}
                        disabled={signetGenerating}
                        class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-all shrink-0"
                        style="background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
                        {signetGenerating ? '…' : '+ Générer'}
                    </button>
                </div>

                {#if signetToken}
                    <!-- QR Code — scannez depuis le téléphone -->
                    <div class="mt-4 flex flex-col items-center gap-3">
                        <p class="text-xs text-gray-500 self-start">Scannez ce QR code depuis votre téléphone :</p>
                        <div class="rounded-xl p-3" style="background: #0a0a0a; border: 1px solid rgba(251,191,36,0.3)">
                            <canvas bind:this={signetQrCanvas}></canvas>
                        </div>
                        <a
                            href={signetQrLink}
                            target="_blank"
                            class="text-xs px-3 py-1.5 rounded-lg transition-colors"
                            style="color: #fbbf24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25)">
                            Ouvrir le lien sur ce navigateur →
                        </a>
                    </div>
                    <!-- Token brut (fallback) -->
                    <details class="mt-3">
                        <summary class="text-xs text-gray-700 cursor-pointer select-none">Afficher le token texte (saisie manuelle)</summary>
                        <div class="mt-2 rounded-lg p-3 flex items-center gap-3" style="background: rgba(0,0,0,0.4); border: 1px solid rgba(251,191,36,0.2)">
                            <code class="flex-1 text-xs font-mono break-all" style="color: #fbbf24">{signetToken}</code>
                            <button
                                onclick={copySignetToken}
                                class="text-xs px-2.5 py-1 rounded shrink-0 transition-colors"
                                style="color: {signetCopied ? 'rgb(74,222,128)' : 'rgb(156,163,175)'}; border: 1px solid {signetCopied ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}">
                                {signetCopied ? '✓ Copié' : 'Copier'}
                            </button>
                        </div>
                    </details>
                    <p class="text-xs text-gray-700 mt-2">Expire dans 15 minutes · Usage unique</p>
                {/if}
            </div>
        </section>
        {/if}
    </div>
</div>