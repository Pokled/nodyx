<script lang="ts">
    import NetworkDoctor from '$lib/components/NetworkDoctor.svelte';
    import { page } from '$app/stores';

    import { PUBLIC_API_URL, PUBLIC_SIGNET_URL } from '$env/static/public';
    import { tick } from 'svelte';
    import { t, locale, LOCALES, type Locale } from '$lib/i18n';
    import { get } from 'svelte/store';

    // ── i18n — Svelte 5 runes-compatible reactive wrappers ────────────────────
    // $t and $locale are legacy store subscriptions; wrapping in $derived ensures
    // Svelte 5's rune dependency tracker re-renders the component on locale change.
    const tFn          = $derived($t)
    const currentLocale = $derived($locale)

    // ── Navigation ────────────────────────────────────────────────────────────
    let activeSection = $state('network')
    let langSaved     = $state(false)

    function setLocale(code: Locale) {
        locale.setLocale(code)
        langSaved = true
        setTimeout(() => langSaved = false, 2000)
    }

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
            totpSuccess = get(t)('settings.security.2fa.success_enabled')
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
            totpSuccess = get(t)('settings.security.2fa.success_disabled')
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

        navigator.serviceWorker.ready.then(async reg => {
            const sub = await reg.pushManager.getSubscription()
            pushEnabled = !!sub
        })

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
                await existing.unsubscribe()
                await fetch('/api/v1/notifications/subscribe', {
                    method:  'DELETE',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body:    JSON.stringify({ endpoint: existing.endpoint }),
                })
                pushEnabled = false
            } else {
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

<!-- ══════════════════════════════════════════════════════════════════════════
     SETTINGS — Layout principal
     ══════════════════════════════════════════════════════════════════════════ -->
<div class="settings-root">

    <!-- ── Sidebar navigation ──────────────────────────────────────────────── -->
    <aside class="settings-sidebar">

        <!-- Header -->
        <div class="sb-header">
            <a href="/" class="sb-back" title={tFn('common.back')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                {tFn('common.back')}
            </a>
            <div class="sb-title-block">
                <span class="sb-eyebrow">{tFn('settings.my_account')}</span>
                <h1 class="sb-title">{tFn('settings.title')}</h1>
            </div>
        </div>

        <!-- Nav items -->
        <nav class="sb-nav">
            <div class="sb-section-label">{tFn('settings.nav.general')}</div>

            <button class="sb-item {activeSection === 'network' ? 'active' : ''}"
                    onclick={() => activeSection = 'network'}>
                <span class="sb-icon" style="background: rgba(99,102,241,0.15); color: #818cf8">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.network.label')}</span>
            </button>

            <button class="sb-item {activeSection === 'notifications' ? 'active' : ''}"
                    onclick={() => activeSection = 'notifications'}>
                <span class="sb-icon" style="background: rgba(139,92,246,0.15); color: #a78bfa">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.notifications.label')}</span>
                {#if pushEnabled}
                    <span class="sb-badge-dot" style="background:#4ade80"></span>
                {/if}
            </button>

            <button class="sb-item {activeSection === 'instances' ? 'active' : ''}"
                    onclick={() => activeSection = 'instances'}>
                <span class="sb-icon" style="background: rgba(6,182,212,0.12); color: #67e8f9">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.instances.label')}</span>
                {#if linkedSlugs.length > 0}
                    <span class="sb-badge">{linkedSlugs.length}</span>
                {/if}
            </button>

            <div class="sb-section-label" style="margin-top: 16px">{tFn('settings.nav.security')}</div>

            <button class="sb-item {activeSection === 'security' ? 'active' : ''}"
                    onclick={() => activeSection = 'security'}>
                <span class="sb-icon" style="background: rgba(239,68,68,0.1); color: #f87171">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.security.label')}</span>
                {#if totpEnabled}
                    <span class="sb-badge-dot" style="background:#4ade80"></span>
                {:else if totpLoaded}
                    <span class="sb-badge-dot" style="background:#6b7280"></span>
                {/if}
            </button>

            <button class="sb-item {activeSection === 'signet' ? 'active' : ''}"
                    onclick={() => activeSection = 'signet'}>
                <span class="sb-icon" style="background: rgba(251,191,36,0.1); color: #fbbf24">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.signet.label')}</span>
                {#if signetDevices.length > 0}
                    <span class="sb-badge">{signetDevices.length}</span>
                {/if}
            </button>

            <div class="sb-section-label" style="margin-top: 16px">{tFn('settings.nav.preferences')}</div>

            <button class="sb-item {activeSection === 'language' ? 'active' : ''}"
                    onclick={() => activeSection = 'language'}>
                <span class="sb-icon" style="background: rgba(16,185,129,0.12); color: #34d399">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
                    </svg>
                </span>
                <span class="sb-label">{tFn('settings.language.label')}</span>
            </button>
        </nav>

        <!-- Footer -->
        <div class="sb-footer">
            <div class="sb-version">{tFn('settings.version')}</div>
            <a href="https://nodyx.dev" target="_blank" rel="noopener" class="sb-docs-link">
                {tFn('settings.docs')}
            </a>
        </div>
    </aside>

    <!-- ── Contenu principal ──────────────────────────────────────────────── -->
    <main class="settings-main">

        <!-- ═══ RÉSEAU ══════════════════════════════════════════════════════ -->
        {#if activeSection === 'network'}
        <div class="s-pane" style="--accent: #818cf8; --accent-bg: rgba(99,102,241,0.08); --accent-border: rgba(99,102,241,0.2)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.network.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.network.desc')}</p>
                </div>
            </div>
            <div class="s-card">
                <NetworkDoctor />
            </div>
        </div>
        {/if}

        <!-- ═══ NOTIFICATIONS ════════════════════════════════════════════════ -->
        {#if activeSection === 'notifications'}
        <div class="s-pane" style="--accent: #a78bfa; --accent-bg: rgba(139,92,246,0.08); --accent-border: rgba(139,92,246,0.2)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.notifications.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.notifications.desc')}</p>
                </div>
            </div>

            {#if pushSupported && $page.data.user}
            <div class="s-card">
                <div class="s-row">
                    <div class="s-row-info">
                        <div class="s-row-title">{tFn('settings.notifications.push.title')}</div>
                        <div class="s-row-sub">
                            {pushEnabled
                                ? tFn('settings.notifications.push.enabled_desc')
                                : tFn('settings.notifications.push.disabled_desc')}
                        </div>
                    </div>
                    <button
                        onclick={togglePush}
                        disabled={pushLoading || !vapidPublicKey}
                        class="s-toggle {pushEnabled ? 'on' : 'off'}"
                        aria-label="Toggle notifications"
                    >
                        <span class="s-toggle-thumb">
                            {#if pushLoading}
                                <span class="s-spin"></span>
                            {/if}
                        </span>
                    </button>
                </div>

                {#if !vapidPublicKey}
                <div class="s-info-banner">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                    {tFn('settings.notifications.push.not_configured_hint')}
                </div>
                {/if}
                {#if pushError}
                <div class="s-error-banner">{pushError}</div>
                {/if}
            </div>

            <div class="s-card s-card-muted">
                <p class="s-hint-text">
                    {tFn('settings.notifications.privacy')}
                </p>
            </div>
            {:else if !pushSupported}
            <div class="s-card s-card-muted">
                <p class="s-hint-text">{tFn('settings.notifications.push.unsupported')}</p>
            </div>
            {/if}
        </div>
        {/if}

        <!-- ═══ INSTANCES ════════════════════════════════════════════════════ -->
        {#if activeSection === 'instances'}
        <div class="s-pane" style="--accent: #67e8f9; --accent-bg: rgba(6,182,212,0.08); --accent-border: rgba(6,182,212,0.2)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.instances.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.instances.desc')}</p>
                </div>
            </div>

            {#if user}
            <!-- Liste des instances -->
            {#if linkedSlugs.length > 0}
            <div class="s-card" style="padding: 0; overflow: hidden">
                {#each linkedSlugs as slug, i}
                    {@const known = directoryInstances.find(inst => inst.slug === slug)}
                    <div class="s-instance-row {i > 0 ? 'border-top' : ''}">
                        <div class="s-instance-logo">
                            {#if known?.logo_url}
                                <img src={known.logo_url.startsWith('http') ? known.logo_url : known.url.replace(/\/$/, '') + known.logo_url} alt={known.name} />
                            {:else}
                                <span>{slug.charAt(0).toUpperCase()}</span>
                            {/if}
                        </div>
                        <div class="s-instance-info">
                            <div class="s-instance-name">{known?.name ?? slug}</div>
                            <div class="s-instance-url">{known?.url ?? slug + '.nodyx.org'}</div>
                        </div>
                        <button
                            onclick={() => removeInstance(slug)}
                            class="s-danger-btn"
                        >
                            Retirer
                        </button>
                    </div>
                {/each}
            </div>
            {:else}
            <div class="s-empty-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:12px">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                </svg>
                <p>{tFn('settings.instances.empty')}</p>
                <p style="font-size:11px;opacity:0.5;margin-top:4px">{tFn('settings.instances.empty_hint')}</p>
            </div>
            {/if}

            <!-- Ajouter -->
            {#if directoryInstances.length > 0}
            <div class="s-card">
                <div class="s-row-title" style="margin-bottom:10px">{tFn('settings.instances.add_title')}</div>
                <div class="s-add-instance-row">
                    <div class="s-input-wrap" style="flex:1;position:relative">
                        <input
                            list="directory-slugs"
                            type="text"
                            bind:value={newSlug}
                            placeholder={tFn('settings.instances.placeholder')}
                            onkeydown={(e) => e.key === 'Enter' && addInstance()}
                            class="s-input"
                        />
                        <datalist id="directory-slugs">
                            {#each directoryInstances.filter(i => !linkedSlugs.includes(i.slug)) as inst}
                                <option value={inst.slug}>{inst.name}</option>
                            {/each}
                        </datalist>
                    </div>
                    <button onclick={addInstance} disabled={slugLoading} class="s-primary-btn">
                        {slugLoading ? '…' : 'Ajouter'}
                    </button>
                </div>
                {#if slugError}
                    <p class="s-field-error">{slugError}</p>
                {/if}
                <p class="s-hint-text" style="margin-top:10px">
                    {tFn('settings.instances.slug_hint', { slug: 'french-godot' })}
                </p>
            </div>
            {/if}
            {/if}
        </div>
        {/if}

        <!-- ═══ SÉCURITÉ 2FA ════════════════════════════════════════════════ -->
        {#if activeSection === 'security' && $page.data.user}
        <div class="s-pane" style="--accent: #f87171; --accent-bg: rgba(239,68,68,0.07); --accent-border: rgba(239,68,68,0.18)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.security.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.security.desc')}</p>
                </div>
            </div>

            {#if totpSuccess}
            <div class="s-success-banner">{totpSuccess}</div>
            {/if}

            <!-- État idle -->
            {#if totpStep === 'idle'}
            <div class="s-card">
                <div class="s-row">
                    <div class="s-row-info">
                        <div class="s-row-title">{tFn('settings.security.2fa.title')}</div>
                        <div class="s-row-sub">
                            {totpEnabled
                                ? tFn('settings.security.2fa.enabled_desc')
                                : tFn('settings.security.2fa.disabled_desc')}
                        </div>
                    </div>
                    <div class="s-status-pill {totpEnabled ? 'active' : 'inactive'}">
                        <span class="s-status-dot"></span>
                        {totpEnabled ? tFn('common.active') : tFn('common.inactive')}
                    </div>
                </div>
                {#if totpError}
                    <div class="s-error-banner" style="margin-top:12px">{totpError}</div>
                {/if}
                <div class="s-row-actions">
                    {#if totpEnabled}
                        <button
                            onclick={() => { totpStep = 'disable'; totpCode = ''; totpError = '' }}
                            class="s-ghost-danger-btn"
                        >{tFn('settings.security.2fa.disable')}</button>
                    {:else}
                        <button
                            onclick={totpStartSetup}
                            disabled={totpLoading}
                            class="s-primary-btn"
                        >{totpLoading ? '…' : tFn('settings.security.2fa.enable')}</button>
                    {/if}
                </div>
            </div>

            <!-- Setup -->
            {:else if totpStep === 'setup'}
            <div class="s-card totp-setup-card">
                <div class="totp-step">
                    <div class="totp-step-num">1</div>
                    <div class="totp-step-content">
                        <p class="s-row-title">{tFn('settings.security.2fa.step1')}</p>
                        <p class="s-row-sub" style="margin-bottom:16px">{tFn('settings.security.2fa.step1_hint')}</p>
                        {#if totpQr}
                        <div class="totp-qr-wrap">
                            <img src={totpQr} alt="QR code 2FA" />
                        </div>
                        {/if}
                        {#if totpSecret}
                        <details style="margin-top:12px">
                            <summary class="s-hint-text" style="cursor:pointer;user-select:none">{tFn('settings.security.2fa.manual_key')}</summary>
                            <code class="totp-secret">{totpSecret}</code>
                        </details>
                        {/if}
                    </div>
                </div>

                <div class="totp-divider"></div>

                <div class="totp-step">
                    <div class="totp-step-num">2</div>
                    <div class="totp-step-content">
                        <p class="s-row-title">{tFn('settings.security.2fa.step2')}</p>
                        <p class="s-row-sub" style="margin-bottom:12px">{tFn('settings.security.2fa.step2_hint')}</p>
                        {#if totpError}
                            <div class="s-error-banner" style="margin-bottom:10px">{totpError}</div>
                        {/if}
                        <div class="totp-confirm-row">
                            <input
                                type="text"
                                inputmode="numeric"
                                pattern="[0-9]{6}"
                                maxlength="6"
                                bind:value={totpCode}
                                placeholder="000000"
                                onkeydown={(e) => e.key === 'Enter' && totpCode.length === 6 && totpConfirm()}
                                class="s-input totp-input"
                            />
                            <button onclick={totpConfirm} disabled={totpLoading || totpCode.length < 6} class="s-primary-btn">
                                {totpLoading ? '…' : tFn('common.enable')}
                            </button>
                            <button onclick={totpCancel} class="s-ghost-btn">{tFn('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Disable -->
            {:else if totpStep === 'disable'}
            <div class="s-card" style="border-color: rgba(239,68,68,0.2)">
                <p class="s-row-title">{tFn('settings.security.2fa.disable_title')}</p>
                <p class="s-row-sub" style="margin-bottom:16px">{tFn('settings.security.2fa.disable_hint')}</p>
                {#if totpError}
                    <div class="s-error-banner" style="margin-bottom:12px">{totpError}</div>
                {/if}
                <div class="totp-confirm-row">
                    <input
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]{6}"
                        maxlength="6"
                        bind:value={totpCode}
                        placeholder="000000"
                        onkeydown={(e) => e.key === 'Enter' && totpCode.length === 6 && totpDisable()}
                        class="s-input totp-input"
                    />
                    <button onclick={totpDisable} disabled={totpLoading || totpCode.length < 6}
                            class="s-primary-btn" style="background: rgba(239,68,68,0.15); color: #f87171; border-color: rgba(239,68,68,0.3)">
                        {totpLoading ? '…' : tFn('common.disable')}
                    </button>
                    <button onclick={totpCancel} class="s-ghost-btn">{tFn('common.cancel')}</button>
                </div>
            </div>
            {/if}

            <!-- Info -->
            <div class="s-card s-card-muted">
                <p class="s-hint-text">
                    {tFn('settings.security.2fa.privacy')}
                </p>
            </div>
        </div>
        {/if}

        <!-- ═══ NODYX SIGNET ════════════════════════════════════════════════ -->
        {#if activeSection === 'signet' && user}
        <div class="s-pane" style="--accent: #fbbf24; --accent-bg: rgba(251,191,36,0.07); --accent-border: rgba(251,191,36,0.2)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.signet.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.signet.desc')}</p>
                </div>
            </div>

            <!-- Appareils enregistrés -->
            {#if signetDevicesLoaded}
                {#if signetDevices.length > 0}
                <div class="s-card" style="padding:0;overflow:hidden">
                    {#each signetDevices as device, i (device.id)}
                    <div class="s-instance-row {i > 0 ? 'border-top' : ''}" style="border-color: var(--accent-border)">
                        <div class="s-instance-logo signet-device-logo">◈</div>
                        <div class="s-instance-info">
                            <div class="s-instance-name">{device.label}</div>
                            <div class="s-instance-url">
                                {tFn('settings.signet.registered_at', { date: new Date(device.created_at).toLocaleDateString() })}
                                {#if device.last_used_at}
                                    {tFn('settings.signet.used_at', { date: new Date(device.last_used_at).toLocaleDateString() })}
                                {/if}
                            </div>
                        </div>
                        <button
                            onclick={() => revokeSignetDevice(device.id)}
                            disabled={signetRevoking === device.id}
                            class="s-danger-btn"
                        >{signetRevoking === device.id ? '…' : tFn('common.revoke')}</button>
                    </div>
                    {/each}
                </div>
                {:else}
                <div class="s-empty-state" style="border-color: var(--accent-border)">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:12px">
                        <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
                    </svg>
                    <p>{tFn('settings.signet.no_devices')}</p>
                    <p style="font-size:11px;opacity:0.5;margin-top:4px">{tFn('settings.signet.no_devices_hint')}</p>
                </div>
                {/if}
            {:else}
                <div class="s-card s-card-muted">
                    <div class="s-spin" style="margin: 0 auto"></div>
                </div>
            {/if}

            <!-- Générer token -->
            <div class="s-card signet-add-card">
                <div class="s-row">
                    <div class="s-row-info">
                        <div class="s-row-title">{tFn('settings.signet.add_device')}</div>
                        <div class="s-row-sub">{tFn('settings.signet.add_hint')}</div>
                    </div>
                    <button
                        onclick={generateSignetToken}
                        disabled={signetGenerating}
                        class="s-primary-btn signet-gen-btn"
                    >{signetGenerating ? '…' : tFn('common.generate')}</button>
                </div>

                {#if signetToken}
                <div class="signet-token-block">
                    <p class="s-hint-text" style="margin-bottom:12px">{tFn('settings.signet.qr_hint')}</p>
                    <div class="signet-qr-wrap">
                        <canvas bind:this={signetQrCanvas}></canvas>
                    </div>
                    {#if signetQrLink}
                    <a href={signetQrLink} target="_blank" class="signet-open-link">
                        {tFn('common.open_link')}
                    </a>
                    {/if}
                    <details style="margin-top:16px">
                        <summary class="s-hint-text" style="cursor:pointer;user-select:none">{tFn('settings.signet.manual_token')}</summary>
                        <div class="signet-token-raw">
                            <code>{signetToken}</code>
                            <button onclick={copySignetToken} class="signet-copy-btn {signetCopied ? 'copied' : ''}">
                                {signetCopied ? tFn('common.copied') : tFn('common.copy')}
                            </button>
                        </div>
                    </details>
                    <p class="s-hint-text" style="margin-top:10px;opacity:0.5">{tFn('settings.signet.expiry')}</p>
                </div>
                {/if}
            </div>
        </div>
        {/if}

        <!-- ═══ LANGUE ════════════════════════════════════════════════════════ -->
        {#if activeSection === 'language'}
        <div class="s-pane" style="--accent: #34d399; --accent-bg: rgba(16,185,129,0.08); --accent-border: rgba(16,185,129,0.2)">
            <div class="s-pane-header">
                <div class="s-pane-icon" style="background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
                    </svg>
                </div>
                <div>
                    <h2 class="s-pane-title">{tFn('settings.language.title')}</h2>
                    <p class="s-pane-desc">{tFn('settings.language.desc')}</p>
                </div>
            </div>

            <div class="s-card">
                {#if langSaved}
                <div class="s-success-banner" style="margin-bottom:16px">{tFn('settings.language.saved')}</div>
                {/if}
                <div class="lang-flags">
                    {#each LOCALES as loc}
                    <button
                        onclick={() => setLocale(loc.code)}
                        class="lang-flag-item {currentLocale === loc.code ? 'active' : ''}"
                    >
                        <span class="lang-flag">{loc.flag}</span>
                        <span class="lang-flag-label">{loc.label}</span>
                        {#if currentLocale === loc.code}
                        <span class="lang-flag-active">{tFn('common.current')}</span>
                        {/if}
                    </button>
                    {/each}
                </div>
            </div>
        </div>
        {/if}

    </main>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════
     STYLES
     ══════════════════════════════════════════════════════════════════════════ -->
<style>
/* ── Root layout ─────────────────────────────────────────────────────────── */
.settings-root {
    display: flex;
    min-height: calc(100vh - 48px);
    background: #06060a;
    color: #e2e8f0;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
.settings-sidebar {
    width: 240px;
    min-width: 240px;
    display: flex;
    flex-direction: column;
    background: #0a0a10;
    border-right: 1px solid rgba(255,255,255,0.05);
    position: sticky;
    top: 48px;
    height: calc(100vh - 48px);
    overflow-y: auto;
    scrollbar-width: thin;
}

.sb-header {
    padding: 14px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
}

.sb-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #4b5563;
    text-decoration: none;
    transition: color 150ms;
    margin-bottom: 14px;
}
.sb-back:hover { color: #9ca3af; }

.sb-title-block { display: flex; flex-direction: column; gap: 2px; }
.sb-eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #374151;
    font-weight: 600;
}
.sb-title {
    font-size: 18px;
    font-weight: 800;
    color: #f1f5f9;
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.02em;
    margin: 0;
}

.sb-nav {
    flex: 1;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.sb-section-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #374151;
    font-weight: 700;
    padding: 0 8px;
    margin-bottom: 4px;
}

.sb-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: all 150ms;
    text-align: left;
    width: 100%;
    position: relative;
}
.sb-item:hover { background: rgba(255,255,255,0.04); color: #9ca3af; }
.sb-item.active {
    background: rgba(99,102,241,0.12);
    color: #e0e7ff;
}
.sb-item.active .sb-icon { opacity: 1; }

.sb-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.7;
    transition: opacity 150ms;
    border: 1px solid transparent;
}
.sb-item:hover .sb-icon, .sb-item.active .sb-icon { opacity: 1; }

.sb-label {
    font-size: 13px;
    font-weight: 500;
    flex: 1;
}

.sb-badge {
    font-size: 10px;
    font-weight: 700;
    background: rgba(99,102,241,0.2);
    color: #a5b4fc;
    padding: 1px 6px;
    border-radius: 5px;
    min-width: 18px;
    text-align: center;
}

.sb-badge-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
}

.sb-chip {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #374151;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    padding: 2px 6px;
    border-radius: 4px;
}

.sb-footer {
    padding: 12px 16px;
    border-top: 1px solid rgba(255,255,255,0.04);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.sb-version { font-size: 11px; color: #1f2937; font-family: monospace; }
.sb-docs-link { font-size: 11px; color: #374151; text-decoration: none; transition: color 150ms; }
.sb-docs-link:hover { color: #6366f1; }

/* ── Main content ────────────────────────────────────────────────────────── */
.settings-main {
    flex: 1;
    padding: 24px 32px 60px;
    min-height: 100%;
}

/* ── Section pane ────────────────────────────────────────────────────────── */
.s-pane { display: flex; flex-direction: column; gap: 16px; }

.s-pane-header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 4px;
}

.s-pane-icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid var(--accent-border);
}

.s-pane-title {
    font-size: 20px;
    font-weight: 800;
    color: #f1f5f9;
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.02em;
    margin: 0 0 4px 0;
    line-height: 1.2;
}

.s-pane-desc {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.5;
    margin: 0;
}

/* ── Cards ───────────────────────────────────────────────────────────────── */
.s-card {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
    padding: 20px;
}
.s-card-muted {
    background: transparent;
    border-color: rgba(255,255,255,0.04);
}

/* ── Rows ────────────────────────────────────────────────────────────────── */
.s-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
.s-row-info { flex: 1; }
.s-row-title { font-size: 14px; font-weight: 600; color: #e2e8f0; margin-bottom: 3px; }
.s-row-sub { font-size: 12px; color: #4b5563; line-height: 1.5; }
.s-row-actions { margin-top: 16px; display: flex; gap: 8px; }

/* ── Toggle ──────────────────────────────────────────────────────────────── */
.s-toggle {
    width: 44px;
    height: 24px;
    border-radius: 5px;
    position: relative;
    cursor: pointer;
    border: none;
    transition: background 200ms;
    flex-shrink: 0;
}
.s-toggle.on  { background: #6366f1; }
.s-toggle.off { background: rgba(255,255,255,0.1); }
.s-toggle:disabled { opacity: 0.4; cursor: not-allowed; }

.s-toggle-thumb {
    position: absolute;
    top: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: left 200ms cubic-bezier(.4,0,.2,1);
}
.s-toggle.on  .s-toggle-thumb { left: 23px; }
.s-toggle.off .s-toggle-thumb { left: 3px; }

/* ── Status pill ─────────────────────────────────────────────────────────── */
.s-status-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 5px;
    flex-shrink: 0;
}
.s-status-pill.active  { background: rgba(74,222,128,0.1); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
.s-status-pill.inactive { background: rgba(107,114,128,0.1); color: #6b7280; border: 1px solid rgba(107,114,128,0.15); }

.s-status-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: currentColor;
    animation: none;
}
.s-status-pill.active .s-status-dot { animation: pulse-dot 2s ease-in-out infinite; }

@keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.6; transform: scale(0.85); }
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.s-primary-btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    background: rgba(99,102,241,0.15);
    color: #a5b4fc;
    border: 1px solid rgba(99,102,241,0.3);
    cursor: pointer;
    transition: all 150ms;
    flex-shrink: 0;
}
.s-primary-btn:hover:not(:disabled) {
    background: rgba(99,102,241,0.25);
    border-color: rgba(99,102,241,0.5);
    color: #c7d2fe;
}
.s-primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.s-ghost-btn {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    background: transparent;
    color: #4b5563;
    border: none;
    cursor: pointer;
    transition: color 150ms;
}
.s-ghost-btn:hover { color: #9ca3af; }

.s-ghost-danger-btn {
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    background: rgba(239,68,68,0.07);
    color: #f87171;
    border: 1px solid rgba(239,68,68,0.2);
    cursor: pointer;
    transition: all 150ms;
}
.s-ghost-danger-btn:hover { background: rgba(239,68,68,0.14); }

.s-danger-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 7px;
    background: rgba(239,68,68,0.07);
    color: #f87171;
    border: 1px solid rgba(239,68,68,0.18);
    cursor: pointer;
    transition: all 150ms;
    flex-shrink: 0;
}
.s-danger-btn:hover { background: rgba(239,68,68,0.14); }

/* ── Input ───────────────────────────────────────────────────────────────── */
.s-input {
    width: 100%;
    padding: 9px 14px;
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    color: #e2e8f0;
    font-size: 13px;
    outline: none;
    transition: border-color 150ms;
}
.s-input::placeholder { color: #374151; }
.s-input:focus { border-color: rgba(99,102,241,0.5); background: rgba(255,255,255,0.06); }

/* ── Banners ─────────────────────────────────────────────────────────────── */
.s-info-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding: 10px 14px;
    border-radius: 6px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    font-size: 12px;
    color: #4b5563;
}
.s-error-banner {
    padding: 10px 14px;
    border-radius: 6px;
    background: rgba(239,68,68,0.07);
    border: 1px solid rgba(239,68,68,0.2);
    font-size: 12px;
    color: #f87171;
}
.s-success-banner {
    padding: 12px 16px;
    border-radius: 6px;
    background: rgba(74,222,128,0.07);
    border: 1px solid rgba(74,222,128,0.2);
    font-size: 13px;
    color: #4ade80;
    font-weight: 500;
}

.s-hint-text { font-size: 12px; color: #374151; line-height: 1.6; margin: 0; }
.s-hint-text code { color: #6366f1; background: rgba(99,102,241,0.1); padding: 1px 5px; border-radius: 4px; }

.s-field-error { font-size: 11px; color: #f87171; margin-top: 6px; }

/* ── Empty state ─────────────────────────────────────────────────────────── */
.s-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 24px;
    border-radius: 8px;
    border: 1px dashed rgba(255,255,255,0.07);
    color: #374151;
    font-size: 13px;
    text-align: center;
}

/* ── Instances ───────────────────────────────────────────────────────────── */
.s-instance-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
}
.s-instance-row.border-top { border-top: 1px solid rgba(255,255,255,0.05); }

.s-instance-logo {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 800;
    color: #818cf8;
}
.s-instance-logo img { width: 100%; height: 100%; object-fit: cover; }

.s-instance-info { flex: 1; min-width: 0; }
.s-instance-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
.s-instance-url  { font-size: 11px; color: #374151; font-family: monospace; margin-top: 1px; }

.s-add-instance-row { display: flex; gap: 8px; }

/* ── TOTP ────────────────────────────────────────────────────────────────── */
.totp-setup-card { padding: 0; overflow: hidden; }
.totp-step {
    display: flex;
    gap: 16px;
    padding: 20px;
}
.totp-step-num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(99,102,241,0.15);
    border: 1px solid rgba(99,102,241,0.3);
    color: #818cf8;
    font-size: 12px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
}
.totp-step-content { flex: 1; }
.totp-divider { height: 1px; background: rgba(255,255,255,0.05); margin: 0; }
.totp-qr-wrap {
    display: inline-block;
    padding: 12px;
    background: white;
    border-radius: 12px;
}
.totp-qr-wrap img { width: 160px; height: 160px; display: block; }
.totp-secret {
    display: block;
    margin-top: 10px;
    font-size: 11px;
    font-family: monospace;
    color: #818cf8;
    background: rgba(99,102,241,0.08);
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid rgba(99,102,241,0.15);
    word-break: break-all;
    line-height: 1.6;
}
.totp-confirm-row { display: flex; gap: 8px; align-items: center; }
.totp-input { width: 120px !important; text-align: center; font-family: monospace; font-size: 18px; letter-spacing: 0.15em; }

/* ── Signet ──────────────────────────────────────────────────────────────── */
.signet-device-logo {
    background: rgba(251,191,36,0.08);
    border-color: rgba(251,191,36,0.2);
    color: #fbbf24;
    font-size: 16px;
}
.signet-add-card { border-color: rgba(251,191,36,0.15); background: rgba(251,191,36,0.03); }
.signet-gen-btn  {
    background: rgba(251,191,36,0.12);
    color: #fbbf24;
    border-color: rgba(251,191,36,0.3);
}
.signet-gen-btn:hover:not(:disabled) {
    background: rgba(251,191,36,0.2);
    border-color: rgba(251,191,36,0.5);
    color: #fde68a;
}
.signet-token-block {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid rgba(251,191,36,0.1);
}
.signet-qr-wrap {
    display: inline-block;
    padding: 12px;
    border-radius: 8px;
    background: #0a0a0a;
    border: 1px solid rgba(251,191,36,0.2);
}
.signet-open-link {
    display: inline-block;
    margin-top: 12px;
    font-size: 12px;
    color: #fbbf24;
    background: rgba(251,191,36,0.08);
    border: 1px solid rgba(251,191,36,0.2);
    padding: 6px 14px;
    border-radius: 8px;
    text-decoration: none;
    transition: all 150ms;
}
.signet-open-link:hover { background: rgba(251,191,36,0.15); }
.signet-token-raw {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(251,191,36,0.15);
    padding: 10px 14px;
    border-radius: 6px;
}
.signet-token-raw code {
    flex: 1;
    font-size: 11px;
    font-family: monospace;
    color: #fbbf24;
    word-break: break-all;
}
.signet-copy-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: all 150ms;
    flex-shrink: 0;
}
.signet-copy-btn.copied { color: #4ade80; border-color: rgba(74,222,128,0.3); }

/* ── Langue ──────────────────────────────────────────────────────────────── */
.lang-flags {
    display: flex;
    justify-content: center;
    gap: 16px;
    padding: 8px 0;
}
.lang-flag-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 28px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    color: inherit;
    font-family: inherit;
}
.lang-flag-item:hover { border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); }
.lang-flag-item.active { border-color: rgba(16,185,129,0.25); background: rgba(16,185,129,0.05); }
.lang-flag { font-size: 28px; }
.lang-flag-label { font-size: 13px; font-weight: 600; color: #6b7280; }
.lang-flag-active { font-size: 10px; font-weight: 700; color: #34d399; text-transform: uppercase; letter-spacing: 0.08em; }

/* ── Spinner ─────────────────────────────────────────────────────────────── */
.s-spin {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #818cf8;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: block;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
    .settings-root { flex-direction: column; }
    .settings-sidebar {
        width: 100%;
        min-width: unset;
        height: auto;
        position: static;
        border-right: none;
        border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .sb-nav { flex-direction: row; flex-wrap: wrap; padding: 8px; gap: 4px; }
    .sb-section-label { display: none; }
    .sb-item { flex: 0 0 auto; padding: 8px 12px; }
    .sb-label { display: none; }
    .sb-footer { display: none; }
    .settings-main { padding: 20px 16px 40px; }
}
</style>
