<script lang="ts">
	import { onMount } from 'svelte'
	import {
		hasServerBackup, canBackupLocalKey, uploadKeyBackup,
		restoreKeyBackup, deleteKeyBackup, regenerateKey,
	} from '$lib/e2eBackupClient'

	let { token, mode = 'manage', onDone, onSkip }: {
		token: string
		mode?: 'manage' | 'restore'
		onDone?: () => void
		onSkip?: () => void
	} = $props()

	let phrase  = $state('')
	let phrase2 = $state('')
	let busy    = $state(false)
	let error   = $state('')
	let success = $state('')

	// Manage
	let backupExists = $state(false)
	let canBackup    = $state(true)
	let ready        = $state(false)
	let confirmRegen = $state(false)
	let showPhrase   = $state(false)
	let copied       = $state(false)
	// Restauration depuis les réglages (device qui a déjà une clé différente)
	let restoreMode  = $state(false)
	let rPhrase      = $state('')
	let rMsg         = $state('')

	async function restoreHere() {
		rMsg = ''
		if (!rPhrase) { rMsg = 'Entre ta phrase de récupération.'; return }
		busy = true
		try {
			const ok = await restoreKeyBackup(token, rPhrase)
			if (ok) {
				rMsg = '✓ Clé restaurée. Recharge ta conversation : tes messages chiffrés avec cette clé vont réapparaître.'
				restoreMode = false; rPhrase = ''
			} else {
				rMsg = 'Phrase incorrecte, ou sauvegarde introuvable.'
			}
		} finally { busy = false }
	}

	// Générateur : mots simples et concrets, faciles à mémoriser une fois assemblés.
	const WORDS = [
		'soleil','montagne','rivière','tigre','guitare','orange','nuage','forêt','renard','piano',
		'comète','volcan','dauphin','lanterne','cerise','tornade','bambou','hibou','cascade','prairie',
		'saphir','vélo','château','colibri','menthe','galaxie','sirène','tonnerre','érable','panda',
		'horizon','boussole','flamme','noisette','baleine','origami','caramel','aurore','sentier','koala',
		'brume','cactus','écureuil','melon','phare','quartz','ruban','tulipe','vague','zèbre',
		'abricot','biscuit','citron','domino','éclair','figue','girafe','igloo','jongleur','kiwi',
	]

	function genPhrase(): string {
		const n = 5
		const r = new Uint32Array(n)
		crypto.getRandomValues(r)
		return Array.from(r, (v) => WORDS[v % WORDS.length]).join('-')
	}

	function suggestPhrase() {
		const p = genPhrase()
		phrase = p; phrase2 = p; showPhrase = true; error = ''; copied = false
	}

	async function copyPhrase() {
		try { await navigator.clipboard.writeText(phrase); copied = true; setTimeout(() => copied = false, 2000) } catch { /* ignore */ }
	}

	onMount(async () => {
		if (mode === 'manage') {
			backupExists = await hasServerBackup(token)
			canBackup    = await canBackupLocalKey()
		}
		ready = true
	})

	async function setupBackup() {
		error = ''; success = ''
		if (phrase.length < 8) { error = 'La phrase doit faire au moins 8 caractères.'; return }
		if (!showPhrase && phrase !== phrase2) { error = 'Les deux phrases ne correspondent pas.'; return }
		busy = true
		try {
			const ok = await uploadKeyBackup(token, phrase)
			if (ok) {
				success = 'Sauvegarde activée. Garde précieusement ta phrase : sans elle, aucune récupération possible.'
				backupExists = true
				phrase = ''; phrase2 = ''
				onDone?.()
			} else {
				error = 'Échec de la sauvegarde. Réessaie.'
			}
		} catch {
			error = 'Ta clé actuelle ne peut pas être sauvegardée (générée avant cette fonctionnalité).'
		} finally { busy = false }
	}

	async function doRestore() {
		error = ''; success = ''
		if (!phrase) { error = 'Entre ta phrase de récupération.'; return }
		busy = true
		try {
			const ok = await restoreKeyBackup(token, phrase)
			if (ok) { success = 'Clé restaurée. Tes messages chiffrés vont réapparaître.'; onDone?.() }
			else    { error = 'Phrase incorrecte, ou aucune sauvegarde trouvée.' }
		} catch {
			error = 'Échec de la restauration.'
		} finally { busy = false }
	}

	async function removeBackup() {
		busy = true; error = ''; success = ''
		try {
			if (await deleteKeyBackup(token)) { backupExists = false; success = 'Sauvegarde supprimée.' }
		} finally { busy = false }
	}

	async function doRegenerate() {
		busy = true; error = ''; success = ''
		try {
			if (await regenerateKey(token)) {
				canBackup = true; confirmRegen = false
				success = 'Nouvelle clé générée. Définis maintenant ta phrase de récupération.'
			} else { error = 'Échec de la régénération.' }
		} finally { busy = false }
	}
</script>

<div class="kb">
	{#if mode === 'restore'}
		<div class="kb-head">
			<span class="kb-icon">🔑</span>
			<div>
				<div class="kb-title">Retrouve tes messages chiffrés</div>
				<div class="kb-sub">Nouvel appareil détecté. Entre ta phrase de récupération pour restaurer ta clé et relire ton historique.</div>
			</div>
		</div>
		<input class="kb-input" type="password" placeholder="Phrase de récupération"
			bind:value={phrase} onkeydown={(e) => e.key === 'Enter' && doRestore()} autocomplete="off" />
		{#if error}<div class="kb-error">{error}</div>{/if}
		{#if success}<div class="kb-success">{success}</div>{/if}
		<div class="kb-actions">
			<button class="kb-btn-primary" onclick={doRestore} disabled={busy}>{busy ? '…' : 'Restaurer'}</button>
			<button class="kb-btn-ghost" onclick={() => onSkip?.()} disabled={busy}>Créer une nouvelle identité</button>
		</div>
		<div class="kb-hint">Sans la phrase, l'historique précédent reste illisible (chiffrement de bout en bout).</div>

	{:else}
		<!-- mode manage -->
		<div class="kb-head">
			<span class="kb-icon">🔐</span>
			<div>
				<div class="kb-title">Sauvegarde des messages chiffrés</div>
				<div class="kb-sub">Tes DMs sont chiffrés de bout en bout : seul ton appareil détient la clé. Sauvegarde-la pour pouvoir relire tes conversations depuis un autre navigateur ou ton téléphone.</div>
			</div>
			{#if ready}
				<span class="kb-pill {backupExists ? 'on' : 'off'}">
					<span class="kb-dot"></span>{backupExists ? 'Active' : 'Inactive'}
				</span>
			{/if}
		</div>

		{#if ready && !confirmRegen}
		<div class="kb-info">
			<div class="kb-info-row"><span>🔒</span><span>Ta clé est chiffrée <strong>sur ton appareil</strong> par ta phrase. Le serveur n'en reçoit qu'une version verrouillée : même Nodyx ne peut pas la lire.</span></div>
			<div class="kb-info-row"><span>🗝️</span><span>Ta phrase est la <strong>seule</strong> qui ouvre cette sauvegarde, comme la clé de chez toi. Note-la dans un endroit sûr (gestionnaire de mots de passe, carnet).</span></div>
		</div>
		{/if}

		{#if ready && backupExists}
			<div class="kb-restore-box">
				<div class="kb-restore-head">
					<span>♻️</span>
					<span>Tu as une sauvegarde. Sur un autre appareil, ou si tes messages chiffrés ne s'affichent pas ici, restaure ta clé.</span>
				</div>
				{#if !restoreMode}
					<div class="kb-actions">
						<button class="kb-btn-soft" type="button" onclick={() => { restoreMode = true; rMsg = '' }}>Restaurer ma clé sur cet appareil</button>
					</div>
				{:else}
					<input class="kb-input" type="password" placeholder="Ta phrase de récupération"
						bind:value={rPhrase} onkeydown={(e) => e.key === 'Enter' && restoreHere()} autocomplete="off" />
					<div class="kb-actions">
						<button class="kb-btn-primary" type="button" onclick={restoreHere} disabled={busy}>{busy ? '…' : 'Restaurer'}</button>
						<button class="kb-btn-ghost" type="button" onclick={() => { restoreMode = false; rPhrase = '' }} disabled={busy}>Annuler</button>
					</div>
				{/if}
				{#if rMsg}<div class={rMsg.startsWith('✓') ? 'kb-success' : 'kb-error'}>{rMsg}</div>{/if}
			</div>
		{/if}

		{#if ready && !canBackup}
			<div class="kb-note">
				Ta clé a été créée avant cette fonctionnalité : elle n'est pas encore sauvegardable.
				Prépare une clé compatible en un clic, c'est sans risque pour tes futurs messages.
			</div>
			{#if error}<div class="kb-error">{error}</div>{/if}
			{#if !confirmRegen}
				<div class="kb-actions">
					<button class="kb-btn-primary" type="button" onclick={() => confirmRegen = true} disabled={busy}>
						Préparer la sauvegarde
					</button>
				</div>
			{:else}
				<div class="kb-warn">
					Une nouvelle clé va remplacer l'ancienne. Les anciens messages chiffrés
					<strong>déjà affichés sur cet appareil</strong> ne seront plus déchiffrables ici.
					Tes nouveaux messages, eux, seront protégés et sauvegardés.
				</div>
				<div class="kb-actions">
					<button class="kb-btn-primary" type="button" onclick={doRegenerate} disabled={busy}>
						{busy ? '…' : 'Continuer'}
					</button>
					<button class="kb-btn-ghost" type="button" onclick={() => confirmRegen = false} disabled={busy}>Annuler</button>
				</div>
			{/if}
		{:else if ready}
			<div class="kb-gen">
				<button class="kb-btn-soft" type="button" onclick={suggestPhrase}>✨ Proposer une phrase pour moi</button>
				{#if phrase && showPhrase}
					<button class="kb-copy" type="button" onclick={copyPhrase}>{copied ? '✓ Copiée' : 'Copier'}</button>
				{/if}
			</div>
			<div class="kb-examples">
				Exemples qui marchent bien : <code>soleil-tigre-piano-melon-phare</code> ·
				<code>mon vieux chat dort sur le piano</code>
			</div>

			<div class="kb-field">
				<input class="kb-input" type={showPhrase ? 'text' : 'password'} placeholder="Ta phrase de récupération"
					bind:value={phrase} autocomplete="new-password" />
				<button class="kb-eye" type="button" onclick={() => showPhrase = !showPhrase}>{showPhrase ? 'Masquer' : 'Voir'}</button>
			</div>
			{#if !showPhrase}
				<input class="kb-input" type="password" placeholder="Confirme ta phrase"
					bind:value={phrase2} autocomplete="new-password" />
			{/if}

			{#if error}<div class="kb-error">{error}</div>{/if}
			{#if success}<div class="kb-success">{success}</div>{/if}
			<div class="kb-actions">
				<button class="kb-btn-primary" type="button" onclick={setupBackup} disabled={busy}>
					{busy ? '…' : backupExists ? 'Mettre à jour ma phrase' : 'Activer la sauvegarde'}
				</button>
				{#if backupExists}
					<button class="kb-btn-danger" type="button" onclick={removeBackup} disabled={busy}>Supprimer</button>
				{/if}
			</div>
			<div class="kb-hint">
				Astuce : 4-5 mots au hasard, ou une petite phrase qui n'a de sens que pour toi.
				Plus elle est longue, plus elle est solide. Si tu la perds, la sauvegarde reste
				inviolable mais ne pourra plus être ouverte, alors note-la bien.
			</div>
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
		background: rgba(99,102,241,.06); border: 1px solid rgba(99,102,241,.16);
		border-radius: 12px; padding: 12px 14px; }
	.kb-info-row { display: flex; gap: 10px; font-size: 13px; color: #c7d2fe; line-height: 1.45; }
	.kb-info-row span:first-child { flex-shrink: 0; }
	.kb-info-row strong { color: #e0e7ff; }
	.kb-note { font-size: 13px; color: #cbd5e1; line-height: 1.45; }
	.kb-gen { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.kb-btn-soft { padding: 8px 14px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px;
		color: #c7d2fe; background: rgba(99,102,241,.12); border: 1px solid rgba(99,102,241,.25);
		transition: background .15s; }
	.kb-btn-soft:hover { background: rgba(99,102,241,.2); }
	.kb-copy { padding: 8px 12px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px;
		color: #cbd5e1; background: transparent; border: 1px solid rgba(148,163,184,.3); }
	.kb-examples { font-size: 12px; color: #94a3b8; line-height: 1.5; }
	.kb-examples code { background: rgba(15,23,42,.7); border: 1px solid rgba(148,163,184,.18);
		border-radius: 6px; padding: 1px 6px; color: #c7d2fe; font-size: 12px; }
	.kb-field { display: flex; gap: 8px; align-items: stretch; }
	.kb-field .kb-input { flex: 1; }
	.kb-eye { flex-shrink: 0; padding: 0 12px; border-radius: 10px; cursor: pointer;
		font-size: 13px; font-weight: 600; color: #94a3b8;
		background: transparent; border: 1px solid rgba(148,163,184,.2); }
	.kb-restore-box { display: flex; flex-direction: column; gap: 10px;
		background: rgba(34,197,94,.06); border: 1px solid rgba(34,197,94,.2);
		border-radius: 12px; padding: 12px 14px; }
	.kb-restore-head { display: flex; gap: 10px; font-size: 13px; color: #bbf7d0; line-height: 1.45; }
	.kb-restore-head span:first-child { flex-shrink: 0; }
</style>
