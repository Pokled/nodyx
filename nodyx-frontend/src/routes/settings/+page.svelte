<script lang="ts">
    import NetworkDoctor from '$lib/components/NetworkDoctor.svelte';
    import { page } from '$app/stores';

    import { PUBLIC_API_URL } from '$env/static/public';
    import { env } from '$env/dynamic/public';
    const PUBLIC_SIGNET_URL = env.PUBLIC_SIGNET_URL ?? '';
    import { tick } from 'svelte';

    // ── Nodyx Signet ──────────────────────────────────────────────────────────
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

    // ── 2FA TOTP ──────────────────────────────────────────────────────────────

    type TotpStep = 'idle' | 'setup' | 'confirm' | 'disable'

    let totpEnabled   = $state(false)
    let totpLoaded    = $state(false)
    let totpStep      = $state<TotpStep>('idle')
    let totpQr        = $state<string | null>(null)
    let totpSecret    = $state<string | null>(null)
    let totpCode      = $state('')
    let totpError     = $state('')
    let totpLoading   = $state(false)
    let totpSuccess   = $state('')

    $effect(() => {
        const token = ($page.data as any).token as string | null
        if (!token || totpLoaded) return
        fetch('/api/v1/auth/totp/status', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (j) totpEnabled = j.totp_enabled })
            .catch(() => {})
            .finally(() => { totpLoaded = true })
    })

    async function totpStartSetup() {
        const token = ($page.data as any).token as string | null
        if (!token) return
        totpLoading = true; totpError = ''
        try {
            const res = await fetch('/api/v1/auth/totp/setup', {
                method: 'POST', headers: { Authorization: `Bearer ${token}` }
            })
            const j = await res.json()
            if (!res.ok) { totpError = j.error ?? 'Erreur'; return }
            totpQr = j.qr; totpSecret = j.secret
            totpStep = 'setup'
        } catch { totpError = 'Impossible de contacter le serveur.' }
        totpLoading = false
    }

    async function totpConfirm() {
        const token = ($page.data as any).token as string | null
        if (!token || !totpCode) return
        totpLoading = true; totpError = ''
        try {
            const res = await fetch('/api/v1/auth/totp/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ code: totpCode })
            })
            const j = await res.json()
            if (!res.ok) { totpError = j.error ?? 'Code incorrect'; totpLoading = false; return }
            totpEnabled = true; totpStep = 'idle'
            totpCode = ''; totpQr = null; totpSecret = null
            totpSuccess = '2FA activé avec succès !'
            setTimeout(() => totpSuccess = '', 4000)
        } catch { totpError = 'Erreur réseau.' }
        totpLoading = false
    }

    async function totpDisable() {
        const token = ($page.data as any).token as string | null
        if (!token || !totpCode) return
        totpLoading = true; totpError = ''
        try {
            const res = await fetch('/api/v1/auth/totp/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ code: totpCode })
            })
            const j = await res.json()
            if (!res.ok) { totpError = j.error ?? 'Code incorrect'; totpLoading = false; return }
            totpEnabled = false; totpStep = 'idle'
            totpCode = ''
            totpSuccess = '2FA désactivé.'
            setTimeout(() => totpSuccess = '', 4000)
        } catch { totpError = 'Erreur réseau.' }
        totpLoading = false
    }

    function totpCancel() {
        totpStep = 'idle'; totpCode = ''; totpError = ''; totpQr = null; totpSecret = null
    }

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
        }
    }

    // ── Notifications Push ────────────────────────────────────────────────────

    let pushSupported  = $state(false)
    let pushEnabled    = $state(false)
    let pushLoading    = $state(false)
    let pushError      = $state('')
    let vapidPublicKey = $state<string | null>(null)

    $effect(() => {
        if (typeof window === 'undefined') return
        pushSupported = 'serviceWorker' in navigator && 'PushManager' in window
        if (!pushSupported) return

        // Vérifier si déjà abonné
        navigator.serviceWorker.ready.then(async reg => {
            const sub = await reg.pushManager.getSubscription()
            pushEnabled = !!sub
        })

        // Charger la clé VAPID publique
        fetch('/api/v1/notifications/vapid-public-key')
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (j?.publicKey) vapidPublicKey = j.publicKey })
            .catch(() => {})
    })

    function urlBase64ToUint8Array(base64String: string): Uint8Array {
        const padding = '='.repeat((4 - base64String.length % 4) % 4)
        const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
        const raw     = atob(base64)
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
    }

    async function togglePush() {
        const token = ($page.data as any).token as string | null
        if (!token || !pushSupported) return
        pushLoading = true
        pushError   = ''

        try {
            const reg = await navigator.serviceWorker.ready
            const existing = await reg.pushManager.getSubscription()

            if (pushEnabled && existing) {
                // Désabonnement
                await existing.unsubscribe()
                await fetch('/api/v1/notifications/subscribe', {
                    method:  'DELETE',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body:    JSON.stringify({ endpoint: existing.endpoint }),
                })
                pushEnabled = false
            } else {
                // Abonnement
                if (!vapidPublicKey) { pushError = 'Push non configuré sur ce serveur'; return }
                const perm = await Notification.requestPermission()
                if (perm !== 'granted') { pushError = 'Permission refusée par le navigateur'; return }

                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                })

                const subJson = sub.toJSON()
                await fetch('/api/v1/notifications/subscribe', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body:    JSON.stringify({
                        endpoint: subJson.endpoint,
                        keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
                    }),
                })
                pushEnabled = true
            }
        } catch (err: any) {
            pushError = err?.message ?? 'Erreur inconnue'
        } finally {
            pushLoading = false
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

        <!-- ── Notifications Push ────────────────────────────────────────────── -->
        {#if pushSupported && $page.data.user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Notifications Push</h2>
            <p class="text-xs text-gray-600 mb-6">
                Recevez des notifications même lorsque l'onglet est fermé — mentions, messages privés, réponses.
            </p>
            <div class="flex items-center gap-4">
                <button
                    onclick={togglePush}
                    disabled={pushLoading || !vapidPublicKey}
                    class="flex items-center gap-3 px-4 py-2 rounded-lg border transition-all text-sm font-medium
                           {pushEnabled
                             ? 'bg-violet-600/20 border-violet-500 text-violet-300 hover:bg-violet-600/30'
                             : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'}
                           disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {#if pushLoading}
                        <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                    {:else}
                        <span class="text-base">{pushEnabled ? '🔔' : '🔕'}</span>
                    {/if}
                    {pushEnabled ? 'Notifications activées' : 'Activer les notifications'}
                </button>
                {#if !vapidPublicKey}
                    <span class="text-xs text-gray-600">Non configuré sur ce serveur</span>
                {/if}
            </div>
            {#if pushError}
                <p class="text-xs text-red-400 mt-3">{pushError}</p>
            {/if}
        </section>
        {/if}

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
                                        <img src={known.logo_url.startsWith('http') ? known.logo_url : known.url.replace(/\/$/, '') + known.logo_url} alt={known.name} class="w-full h-full object-cover" />
                                    {:else}
                                        <span class="text-xs font-bold text-indigo-300">{slug.charAt(0).toUpperCase()}</span>
                                    {/if}
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-white">{known?.name ?? slug}</p>
                                    <p class="text-xs text-gray-600 font-mono">{known?.url ?? slug + '.nodyx.org'}</p>
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
                    Le slug est le sous-domaine de l'instance — ex: <code class="text-indigo-500">french-godot</code> pour <code class="text-gray-500">french-godot.nodyx.org</code>
                </p>
            {/if}
        </section>
        {/if}

        <!-- ── 2FA TOTP ──────────────────────────────────────────────────── -->
        {#if $page.data.user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Double authentification (2FA)</h2>
            <p class="text-xs text-gray-600 mb-6">
                Protégez votre compte avec un code à usage unique généré par une application comme Google Authenticator, Aegis ou Bitwarden.
            </p>

            {#if totpSuccess}
                <div class="mb-4 rounded-lg border border-green-700/40 bg-green-900/10 px-4 py-2.5 text-sm text-green-400">
                    {totpSuccess}
                </div>
            {/if}

            {#if totpStep === 'idle'}
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-2">
                        <span class="inline-block w-2 h-2 rounded-full {totpEnabled ? 'bg-green-500' : 'bg-gray-600'}"></span>
                        <span class="text-sm {totpEnabled ? 'text-green-400' : 'text-gray-500'}">
                            {totpEnabled ? '2FA activé' : '2FA désactivé'}
                        </span>
                    </div>
                    {#if totpEnabled}
                        <button
                            onclick={() => { totpStep = 'disable'; totpCode = ''; totpError = '' }}
                            class="px-3 py-1.5 rounded-lg text-xs font-medium border border-red-700/40 bg-red-900/10 text-red-400
                                   hover:bg-red-900/20 transition-colors"
                        >Désactiver</button>
                    {:else}
                        <button
                            onclick={totpStartSetup}
                            disabled={totpLoading}
                            class="px-3 py-1.5 rounded-lg text-xs font-medium border border-indigo-700/50 bg-indigo-900/10 text-indigo-400
                                   hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                        >{totpLoading ? '…' : 'Activer le 2FA'}</button>
                    {/if}
                </div>

            {:else if totpStep === 'setup'}
                <div class="rounded-xl border border-indigo-700/30 bg-indigo-900/5 p-5 space-y-5">
                    <div>
                        <p class="text-sm font-semibold text-white mb-1">1. Scannez ce QR code</p>
                        <p class="text-xs text-gray-500 mb-4">Ouvrez votre application d'authentification et scannez ce code.</p>
                        {#if totpQr}
                            <div class="inline-block rounded-xl p-3 bg-white">
                                <img src={totpQr} alt="QR code 2FA" class="w-44 h-44" />
                            </div>
                        {/if}
                        {#if totpSecret}
                            <details class="mt-3">
                                <summary class="text-xs text-gray-600 cursor-pointer select-none">Saisie manuelle (clé secrète)</summary>
                                <code class="block mt-2 text-xs font-mono text-indigo-400 bg-gray-900 rounded px-3 py-2 break-all border border-gray-800">
                                    {totpSecret}
                                </code>
                            </details>
                        {/if}
                    </div>
                    <div>
                        <p class="text-sm font-semibold text-white mb-1">2. Entrez le code de confirmation</p>
                        <p class="text-xs text-gray-500 mb-3">Saisissez le code à 6 chiffres affiché dans votre application.</p>
                        {#if totpError}
                            <p class="mb-2 text-xs text-red-400">{totpError}</p>
                        {/if}
                        <div class="flex gap-2">
                            <input
                                type="text"
                                inputmode="numeric"
                                pattern="[0-9]{6}"
                                maxlength="6"
                                bind:value={totpCode}
                                placeholder="000000"
                                onkeydown={(e) => e.key === 'Enter' && totpCode.length === 6 && totpConfirm()}
                                class="w-36 rounded-lg px-3 py-2 text-center font-mono text-lg tracking-widest
                                       bg-gray-900 border border-gray-700 text-white focus:outline-none focus:border-indigo-500"
                            />
                            <button
                                onclick={totpConfirm}
                                disabled={totpLoading || totpCode.length < 6}
                                class="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-700 hover:bg-indigo-600
                                       disabled:opacity-50 text-white transition-colors"
                            >{totpLoading ? '…' : 'Activer'}</button>
                            <button onclick={totpCancel} class="px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors">
                                Annuler
                            </button>
                        </div>
                    </div>
                </div>

            {:else if totpStep === 'disable'}
                <div class="rounded-xl border border-red-700/30 bg-red-900/5 p-5">
                    <p class="text-sm font-semibold text-white mb-1">Désactiver le 2FA</p>
                    <p class="text-xs text-gray-500 mb-4">Confirmez avec le code de votre application pour désactiver la double authentification.</p>
                    {#if totpError}
                        <p class="mb-3 text-xs text-red-400">{totpError}</p>
                    {/if}
                    <div class="flex gap-2">
                        <input
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]{6}"
                            maxlength="6"
                            bind:value={totpCode}
                            placeholder="000000"
                            onkeydown={(e) => e.key === 'Enter' && totpCode.length === 6 && totpDisable()}
                            class="w-36 rounded-lg px-3 py-2 text-center font-mono text-lg tracking-widest
                                   bg-gray-900 border border-gray-700 text-white focus:outline-none focus:border-indigo-600"
                        />
                        <button
                            onclick={totpDisable}
                            disabled={totpLoading || totpCode.length < 6}
                            class="px-4 py-2 rounded-lg text-sm font-semibold bg-red-700 hover:bg-red-600
                                   disabled:opacity-50 text-white transition-colors"
                        >{totpLoading ? '…' : 'Désactiver'}</button>
                        <button onclick={totpCancel} class="px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors">
                            Annuler
                        </button>
                    </div>
                </div>
            {/if}
        </section>
        {/if}

        <!-- ── Nodyx Signet ──────────────────────────────────────────────── -->
        {#if user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Nodyx Signet</h2>
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
                        <p class="text-xs text-gray-500 mt-0.5">Génère un token à usage unique (15 min) à coller dans l'app Nodyx Signet.</p>
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