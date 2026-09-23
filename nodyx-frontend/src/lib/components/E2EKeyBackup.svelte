<script lang="ts">
	import { onMount } from 'svelte'
	import { t } from '$lib/i18n'
	import { generateRecoveryPhrase } from '$lib/e2ePhraseWords'
	import {
		hasServerBackup, canBackupLocalKey, uploadKeyBackup,
		restoreKeyBackup, deleteKeyBackup, regenerateKey,
	} from '$lib/e2eBackupClient'

	const tFn = $derived($t)

	let { token, mode = 'manage', onDone, onSkip }: {
		token: string
		mode?: 'manage' | 'restore'
		onDone?: () => void
		onSkip?: () => void
	} = $props()

	// Le code de récupération est TOUJOURS généré par la machine, jamais tapé
	// par l'utilisateur : plus de champ à remplir, plus de second champ pour
	// confirmer, plus de risque de faute de frappe qui invaliderait le backup
	// sans qu'on le sache avant d'en avoir besoin. Simplification demandée par
	// Jonathan après le signalement "l'utilisation n'est pas claire... la
	// passe phrase, bref" — le mécanisme ne change pas (PBKDF2 + AES-GCM côté
	// client, serveur aveugle), seule la façon de l'obtenir change.
	let phrase  = $state('')
	let busy    = $state(false)
	let error   = $state('')
	let success = $state('')

	// Manage
	let backupExists = $state(false)
	let canBackup    = $state(true)
	let ready        = $state(false)
	let confirmRegen = $state(false)
	let copied       = $state(false)
	// Restauration depuis les réglages (device qui a déjà une clé différente)
	let restoreMode  = $state(false)
	let rPhrase      = $state('')
	let rMsg         = $state('')

	async function restoreHere() {
		rMsg = ''
		if (!rPhrase) { rMsg = tFn('e2ebackup.err.enter_phrase'); return }
		busy = true
		try {
			const ok = await restoreKeyBackup(token, rPhrase)
			if (ok) {
				rMsg = tFn('e2ebackup.msg.restored_reload')
				restoreMode = false; rPhrase = ''
			} else {
				rMsg = tFn('e2ebackup.err.phrase_wrong_here')
			}
		} finally { busy = false }
	}

	function suggestPhrase() {
		phrase = generateRecoveryPhrase()
		error = ''; copied = false
	}

	async function copyPhrase() {
		try { await navigator.clipboard.writeText(phrase); copied = true; setTimeout(() => copied = false, 2000) } catch { /* ignore */ }
	}

	onMount(async () => {
		if (mode === 'manage') {
			backupExists = await hasServerBackup(token)
			canBackup    = await canBackupLocalKey()
			// Premier réglage : un code est déjà prêt à l'écran dès l'ouverture,
			// zéro action avant de pouvoir copier + activer.
			if (!backupExists && canBackup) phrase = generateRecoveryPhrase()
		}
		ready = true
	})

	async function setupBackup() {
		error = ''; success = ''
		if (phrase.length < 8) { error = tFn('e2ebackup.err.too_short'); return }
		busy = true
		try {
			const ok = await uploadKeyBackup(token, phrase)
			if (ok) {
				success = tFn('e2ebackup.msg.enabled')
				backupExists = true
				phrase = ''
				onDone?.()
			} else {
				error = tFn('e2ebackup.err.save_failed')
			}
		} catch {
			error = tFn('e2ebackup.err.key_incompatible')
		} finally { busy = false }
	}

	async function doRestore() {
		error = ''; success = ''
		if (!phrase) { error = tFn('e2ebackup.err.enter_phrase'); return }
		busy = true
		try {
			const ok = await restoreKeyBackup(token, phrase)
			if (ok) { success = tFn('e2ebackup.msg.restored'); onDone?.() }
			else    { error = tFn('e2ebackup.err.phrase_wrong') }
		} catch {
			error = tFn('e2ebackup.err.restore_failed')
		} finally { busy = false }
	}

	async function removeBackup() {
		busy = true; error = ''; success = ''
		try {
			if (await deleteKeyBackup(token)) { backupExists = false; success = tFn('e2ebackup.msg.deleted') }
		} finally { busy = false }
	}

	async function doRegenerate() {
		busy = true; error = ''; success = ''
		try {
			if (await regenerateKey(token)) {
				canBackup = true; confirmRegen = false
				success = tFn('e2ebackup.msg.regenerated')
			} else { error = tFn('e2ebackup.err.regen_failed') }
		} finally { busy = false }
	}
</script>

<div class="kb">
	{#if mode === 'restore'}
		<div class="kb-head">
			<span class="kb-icon">🔑</span>
			<div>
				<div class="kb-title">{tFn('e2ebackup.restore.title')}</div>
				<div class="kb-sub">{tFn('e2ebackup.restore.sub')}</div>
			</div>
		</div>
		<input class="kb-input" type="password" placeholder={tFn('e2ebackup.ph.recovery_phrase')}
			bind:value={phrase} onkeydown={(e) => e.key === 'Enter' && doRestore()} autocomplete="off" />
		{#if error}<div class="kb-error">{error}</div>{/if}
		{#if success}<div class="kb-success">{success}</div>{/if}
		<div class="kb-actions">
			<button class="kb-btn-primary" onclick={doRestore} disabled={busy}>{busy ? '…' : tFn('e2ebackup.btn.restore')}</button>
			<button class="kb-btn-ghost" onclick={() => onSkip?.()} disabled={busy}>{tFn('e2ebackup.btn.new_identity')}</button>
		</div>
		<div class="kb-hint">{tFn('e2ebackup.restore.hint')}</div>

	{:else}
		<!-- mode manage -->
		<div class="kb-head">
			<span class="kb-icon">🔐</span>
			<div>
				<div class="kb-title">{tFn('e2ebackup.manage.title')}</div>
				<div class="kb-sub">{tFn('e2ebackup.manage.sub')}</div>
			</div>
			{#if ready}
				<span class="kb-pill {backupExists ? 'on' : 'off'}">
					<span class="kb-dot"></span>{backupExists ? tFn('e2ebackup.status.active') : tFn('e2ebackup.status.inactive')}
				</span>
			{/if}
		</div>

		{#if ready && !confirmRegen}
		<div class="kb-info">
			<div class="kb-info-row"><span>🔒</span><span>{@html tFn('e2ebackup.info.encrypted')}</span></div>
			<div class="kb-info-row"><span>🗝️</span><span>{@html tFn('e2ebackup.info.only_key')}</span></div>
		</div>
		{/if}

		{#if ready && backupExists}
			<div class="kb-restore-box">
				<div class="kb-restore-head">
					<span>♻️</span>
					<span>{tFn('e2ebackup.restorebox.text')}</span>
				</div>
				{#if !restoreMode}
					<div class="kb-actions">
						<button class="kb-btn-soft" type="button" onclick={() => { restoreMode = true; rMsg = '' }}>{tFn('e2ebackup.btn.restore_here')}</button>
					</div>
				{:else}
					<input class="kb-input" type="password" placeholder={tFn('e2ebackup.ph.your_phrase')}
						bind:value={rPhrase} onkeydown={(e) => e.key === 'Enter' && restoreHere()} autocomplete="off" />
					<div class="kb-actions">
						<button class="kb-btn-primary" type="button" onclick={restoreHere} disabled={busy}>{busy ? '…' : tFn('e2ebackup.btn.restore')}</button>
						<button class="kb-btn-ghost" type="button" onclick={() => { restoreMode = false; rPhrase = '' }} disabled={busy}>{tFn('e2ebackup.btn.cancel')}</button>
					</div>
				{/if}
				{#if rMsg}<div class={rMsg.startsWith('✓') ? 'kb-success' : 'kb-error'}>{rMsg}</div>{/if}
			</div>
		{/if}

		{#if ready && !canBackup}
			<div class="kb-note">
				{tFn('e2ebackup.note.legacy_key')}
			</div>
			{#if error}<div class="kb-error">{error}</div>{/if}
			{#if !confirmRegen}
				<div class="kb-actions">
					<button class="kb-btn-primary" type="button" onclick={() => confirmRegen = true} disabled={busy}>
						{tFn('e2ebackup.btn.prepare')}
					</button>
				</div>
			{:else}
				<div class="kb-warn">
					{@html tFn('e2ebackup.warn.regen')}
				</div>
				<div class="kb-actions">
					<button class="kb-btn-primary" type="button" onclick={doRegenerate} disabled={busy}>
						{busy ? '…' : tFn('e2ebackup.btn.continue')}
					</button>
					<button class="kb-btn-ghost" type="button" onclick={() => confirmRegen = false} disabled={busy}>{tFn('e2ebackup.btn.cancel')}</button>
				</div>
			{/if}
		{:else if ready}
			{#if phrase}
				<!-- Code déjà prêt à l'écran (premier réglage, ou régénération demandée) :
				     zéro saisie, on copie puis on active. -->
				<div class="kb-code-box">
					<code class="kb-code">{phrase}</code>
					<button class="kb-copy" type="button" onclick={copyPhrase}>{copied ? tFn('e2ebackup.btn.copied') : tFn('e2ebackup.btn.copy')}</button>
				</div>
				<div class="kb-hint">{tFn('e2ebackup.hint.tip')}</div>
				{#if error}<div class="kb-error">{error}</div>{/if}
				<div class="kb-actions">
					<button class="kb-btn-primary" type="button" onclick={setupBackup} disabled={busy}>
						{busy ? '…' : backupExists ? tFn('e2ebackup.btn.update') : tFn('e2ebackup.btn.enable')}
					</button>
					<button class="kb-btn-ghost" type="button" onclick={suggestPhrase} disabled={busy}>{tFn('e2ebackup.btn.regenerate')}</button>
				</div>
			{:else}
				<!-- Backup déjà actif, rien en cours : juste la possibilité d'en changer. -->
				{#if success}<div class="kb-success">{success}</div>{/if}
				<div class="kb-actions">
					<button class="kb-btn-soft" type="button" onclick={suggestPhrase}>{tFn('e2ebackup.btn.new_code')}</button>
					<button class="kb-btn-danger" type="button" onclick={removeBackup} disabled={busy}>{tFn('e2ebackup.btn.delete')}</button>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.kb { display: flex; flex-direction: column; gap: 12px; }
	.kb-head { display: flex; align-items: flex-start; gap: 12px; }
	.kb-icon { font-size: 22px; line-height: 1; }
	.kb-title { font-size: 15px; font-weight: 600; color: #fff; }
	.kb-sub { font-size: 13px; color: #94a3b8; margin-top: 2px; line-height: 1.45; }
	.kb-pill { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
		padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
	.kb-pill.on  { background: rgba(34,197,94,.12);  color: #4ade80; }
	.kb-pill.off { background: rgba(148,163,184,.12); color: #94a3b8; }
	.kb-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
	.kb-input { width: 100%; padding: 10px 12px; border-radius: 10px;
		background: rgba(15,23,42,.6); border: 1px solid rgba(148,163,184,.2);
		color: #f1f5f9; font-size: 14px; outline: none; transition: border-color .15s; }
	.kb-input:focus { border-color: var(--nx-accent); }
	.kb-actions { display: flex; gap: 10px; flex-wrap: wrap; }
	.kb-btn-primary { padding: 9px 16px; border-radius: 10px; border: none; cursor: pointer;
		font-weight: 600; font-size: 14px; color: #fff;
		background: linear-gradient(135deg, var(--nx-accent), var(--nx-accent-2)); transition: transform .12s, opacity .12s; }
	.kb-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
	.kb-btn-ghost, .kb-btn-danger { padding: 9px 16px; border-radius: 10px; cursor: pointer;
		font-weight: 600; font-size: 14px; background: transparent; }
	.kb-btn-ghost  { border: 1px solid rgba(148,163,184,.3); color: #cbd5e1; }
	.kb-btn-danger { border: 1px solid rgba(239,68,68,.35); color: #f87171; }
	.kb-btn-primary:disabled, .kb-btn-ghost:disabled, .kb-btn-danger:disabled { opacity: .5; cursor: default; }
	.kb-error   { font-size: 13px; color: #f87171; }
	.kb-success { font-size: 13px; color: #4ade80; }
	.kb-warn { font-size: 13px; color: #fbbf24; background: rgba(251,191,36,.08);
		border: 1px solid rgba(251,191,36,.2); border-radius: 10px; padding: 10px 12px; line-height: 1.45; }
	.kb-hint { font-size: 12px; color: #64748b; line-height: 1.4; }

	.kb-info { display: flex; flex-direction: column; gap: 8px;
		background: rgb(var(--nx-accent-rgb) / .06); border: 1px solid rgb(var(--nx-accent-rgb) / .16);
		border-radius: 12px; padding: 12px 14px; }
	.kb-info-row { display: flex; gap: 10px; font-size: 13px; color: #c7d2fe; line-height: 1.45; }
	.kb-info-row span:first-child { flex-shrink: 0; }
	.kb-info-row :global(strong) { color: #e0e7ff; }
	.kb-note { font-size: 13px; color: #cbd5e1; line-height: 1.45; }
	.kb-btn-soft { padding: 8px 14px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px;
		color: #c7d2fe; background: rgb(var(--nx-accent-rgb) / .12); border: 1px solid rgb(var(--nx-accent-rgb) / .25);
		transition: background .15s; }
	.kb-btn-soft:hover { background: rgb(var(--nx-accent-rgb) / .2); }
	.kb-code-box { display: flex; align-items: center; gap: 10px; padding: 12px 14px;
		background: rgba(15,23,42,.7); border: 1px solid rgb(var(--nx-accent-rgb) / .3); border-radius: 12px; }
	.kb-code { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 14px; font-weight: 600; color: #e0e7ff; letter-spacing: .01em;
		white-space: pre-wrap; word-break: break-word; user-select: all; }
	.kb-copy { flex-shrink: 0; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px;
		color: #cbd5e1; background: transparent; border: 1px solid rgba(148,163,184,.3); }
	.kb-restore-box { display: flex; flex-direction: column; gap: 10px;
		background: rgba(34,197,94,.06); border: 1px solid rgba(34,197,94,.2);
		border-radius: 12px; padding: 12px 14px; }
	.kb-restore-head { display: flex; gap: 10px; font-size: 13px; color: #bbf7d0; line-height: 1.45; }
	.kb-restore-head span:first-child { flex-shrink: 0; }
</style>
