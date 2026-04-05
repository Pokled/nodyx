<script lang="ts">
	import { t } from '$lib/i18n'

	const tFn = $derived($t)
  import { fade, fly } from 'svelte/transition'
  import { flip } from 'svelte/animate'

  // ── Props ────────────────────────────────────────────────────────────────────

  let { token, channelId, threadId, onCreated, onCollect, onClose }: {
    token:      string | null
    channelId:  number | string | null
    threadId?:  string | null
    onCreated?: (poll: any) => void
    onCollect?: (data: any) => void  // mode inline : ne soumet pas l'API, renvoie la config
    onClose?:   () => void
  } = $props()

  // ── State ────────────────────────────────────────────────────────────────────

  type PollType = 'choice' | 'schedule' | 'ranking'

  let step       = $state<'type' | 'form'>('type')
  let pollType   = $state<PollType>('choice')
  let submitting = $state(false)
  let error      = $state<string | null>(null)

  // Form fields
  let title        = $state('')
  let description  = $state('')
  let multiple     = $state(false)
  let maxChoices   = $state('')
  let anonymous    = $state(false)
  let showResults  = $state(true)
  let closesAt     = $state('')

  interface Option {
    id:          string
    label:       string
    description: string
    image_url:   string
    date_start:  string
    date_end:    string
  }

  let options = $state<Option[]>([
    { id: crypto.randomUUID(), label: '', description: '', image_url: '', date_start: '', date_end: '' },
    { id: crypto.randomUUID(), label: '', description: '', image_url: '', date_start: '', date_end: '' },
  ])

  let draggingIdx = $state<number | null>(null)

  // ── Type descriptors ─────────────────────────────────────────────────────────

  const TYPE_INFO = $derived([
    {
      type:    'choice' as PollType,
      icon:    '📊',
      label:   tFn('poll.type_choice_label'),
      desc:    tFn('poll.type_choice_desc'),
      example: tFn('poll.type_choice_example'),
    },
    {
      type:    'schedule' as PollType,
      icon:    '📅',
      label:   tFn('poll.type_schedule_label'),
      desc:    tFn('poll.type_schedule_desc'),
      example: tFn('poll.type_schedule_example'),
    },
    {
      type:    'ranking' as PollType,
      icon:    '🏆',
      label:   tFn('poll.type_ranking_label'),
      desc:    tFn('poll.type_ranking_desc'),
      example: tFn('poll.type_ranking_example'),
    },
  ])

  // ── Option management ────────────────────────────────────────────────────────

  function addOption() {
    if (options.length >= 20) return
    options = [...options, {
      id: crypto.randomUUID(), label: '', description: '', image_url: '', date_start: '', date_end: '',
    }]
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return
    options = options.filter((_, i) => i !== idx)
  }

  function moveOption(from: number, to: number) {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    options = next
  }

  // ── Bulk date generator (schedule) ──────────────────────────────────────────

  let bulkDate      = $state('')
  let bulkTimeSlots = $state('09:00,14:00,18:00')

  function generateScheduleSlots() {
    if (!bulkDate) return
    const slots = bulkTimeSlots.split(',').map(t => t.trim()).filter(Boolean)
    const newOpts: Option[] = slots.map(time => {
      const [h, m] = time.split(':').map(Number)
      const start  = new Date(`${bulkDate}T${time}:00`)
      const end    = new Date(start.getTime() + 60 * 60 * 1000) // +1h
      return {
        id:          crypto.randomUUID(),
        label:       `${new Intl.DateTimeFormat([], { weekday: 'long', day: 'numeric', month: 'long' }).format(start)} à ${time}`,
        description: '',
        image_url:   '',
        date_start:  start.toISOString().slice(0, 16),
        date_end:    end.toISOString().slice(0, 16),
      }
    })
    options = options.filter(o => o.label).length > 0
      ? [...options.filter(o => o.label), ...newOpts]
      : newOpts
    if (options.length === 0) addOption()
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  const isValid = $derived(() => {
    if (!title.trim()) return false
    const filledOpts = options.filter(o => o.label.trim())
    if (filledOpts.length < 2) return false
    if (pollType === 'schedule') {
      for (const opt of filledOpts) {
        if (!opt.date_start) return false
      }
    }
    return true
  })

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function submit() {
    if (!isValid() || submitting) return
    submitting = true
    error      = null

    const payload = {
      title:        title.trim(),
      description:  description.trim() || undefined,
      type:         pollType,
      multiple:     pollType === 'choice' ? multiple : false,
      max_choices:  pollType === 'choice' && multiple && maxChoices ? Number(maxChoices) : null,
      anonymous,
      show_results: showResults,
      closes_at:    closesAt ? new Date(closesAt).toISOString() : null,
      channel_id:   channelId ? String(channelId) : null,
      thread_id:    threadId  ? String(threadId)  : null,
      options: options
        .filter(o => o.label.trim())
        .map(o => ({
          label:       o.label.trim(),
          description: o.description.trim() || undefined,
          image_url:   o.image_url.trim() || undefined,
          date_start:  o.date_start ? new Date(o.date_start).toISOString() : undefined,
          date_end:    o.date_end   ? new Date(o.date_end).toISOString()   : undefined,
        })),
    }

    // Mode collecte (nouveau sujet) : on ne soumet pas l'API, on passe la config au parent
    if (onCollect) {
      onCollect(payload)
      submitting = false
      return
    }

    try {
      const res  = await fetch('/api/v1/polls', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        onCreated?.(data.poll)
        onClose?.()
      } else {
        error = data.error ?? 'Erreur lors de la création'
      }
    } finally {
      submitting = false
    }
  }
</script>

<!-- ── Backdrop ──────────────────────────────────────────────────────────────── -->
<div class="creator-backdrop" onclick={() => onClose?.()} transition:fade={{ duration: 150 }}></div>

<!-- ── Modal ──────────────────────────────────────────────────────────────────── -->
<div class="creator-modal" transition:fly={{ y: 20, duration: 200 }}>

  <!-- Header -->
  <div class="creator-header">
    <h2>
      {#if step === 'type'}
        Créer un sondage
      {:else}
        {TYPE_INFO.find(t => t.type === pollType)?.icon}
        Sondage — {TYPE_INFO.find(t => t.type === pollType)?.label}
      {/if}
    </h2>
    <button class="btn-close" onclick={() => onClose?.()}>✕</button>
  </div>

  <div class="creator-body">

    <!-- ═══ STEP 1 : choisir le type ═══ -->
    {#if step === 'type'}
      <div class="type-grid">
        {#each TYPE_INFO as t}
          <button
            class="type-card"
            class:selected={pollType === t.type}
            onclick={() => { pollType = t.type; step = 'form' }}
          >
            <span class="type-icon">{t.icon}</span>
            <span class="type-label">{t.label}</span>
            <p class="type-desc">{t.desc}</p>
            <p class="type-example">Ex : {t.example}</p>
          </button>
        {/each}
      </div>

    <!-- ═══ STEP 2 : formulaire ═══ -->
    {:else}
      <div class="form-cols">

        <!-- Colonne gauche — titre, options -->
        <div class="form-col-main">

          <!-- Titre -->
          <div class="field">
            <label for="poll-title">{tFn('poll.question_label')}</label>
            <input
              id="poll-title"
              type="text"
              bind:value={title}
              placeholder={tFn('poll.question_placeholder')}
              maxlength="500"
              autofocus
            />
          </div>

          <!-- Description -->
          <div class="field">
            <label for="poll-desc">Description <span class="optional">(optionnel)</span></label>
            <textarea id="poll-desc" bind:value={description} rows="2"
              placeholder={tFn('poll.description_placeholder')}></textarea>
          </div>

          <!-- Générateur rapide de créneaux (schedule) -->
          {#if pollType === 'schedule'}
            <div class="bulk-generator">
              <h4>{tFn('poll.schedule.slot_generator_title')}</h4>
              <div class="bulk-row">
                <div class="field">
                  <label>{tFn('common.date')}</label>
                  <input type="date" bind:value={bulkDate} />
                </div>
                <div class="field">
                  <label>{tFn('poll.schedule.times_label')}</label>
                  <input type="text" bind:value={bulkTimeSlots} placeholder={tFn('poll.schedule.times_placeholder')} />
                </div>
              </div>
              <button class="btn-generate" onclick={generateScheduleSlots} disabled={!bulkDate}>
                + Générer les créneaux
              </button>
            </div>
          {/if}

          <!-- Options -->
          <div class="options-section">
            <div class="options-header">
              <h4>Options * <span class="optional">({options.filter(o => o.label.trim()).length}/{options.length})</span></h4>
              {#if options.length < 20}
                <button class="btn-add-opt" onclick={addOption}>{tFn('poll.add_option_button')}</button>
              {/if}
            </div>

            <div class="options-list">
              {#each options as opt, i (opt.id)}
                <div class="option-row" animate:flip={{ duration: 180 }}>
                  <span class="opt-num">{i + 1}</span>

                  <div class="opt-fields">
                    {#if pollType === 'schedule'}
                      <!-- Date + label pour le planning -->
                      <div class="sched-row-fields">
                        <input
                          type="datetime-local"
                          bind:value={opt.date_start}
                          placeholder="Début"
                          class="input-datetime"
                        />
                        <input
                          type="text"
                          bind:value={opt.label}
                          placeholder={tFn('poll.schedule.slot_label_placeholder')}
                          class="input-label-sched"
                        />
                      </div>
                    {:else}
                      <input
                        type="text"
                        bind:value={opt.label}
                        placeholder={tFn('poll.option_placeholder', { n: String(i + 1) })}
                        maxlength="250"
                      />
                      {#if opt.label.trim()}
                        <input
                          type="text"
                          bind:value={opt.description}
                          placeholder={tFn('poll.option_description_placeholder')}
                          maxlength="200"
                          class="input-opt-desc"
                        />
                      {/if}
                    {/if}
                  </div>

                  <!-- Move up / down -->
                  <div class="opt-move">
                    <button onclick={() => moveOption(i, i - 1)} disabled={i === 0} title={tFn('common.move_up_tooltip')}>↑</button>
                    <button onclick={() => moveOption(i, i + 1)} disabled={i === options.length - 1} title={tFn('common.move_down_tooltip')}>↓</button>
                  </div>

                  {#if options.length > 2}
                    <button class="opt-remove" onclick={() => removeOption(i)} title={tFn('common.delete_tooltip')}>✕</button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Colonne droite — paramètres -->
        <div class="form-col-settings">
          <h4>{tFn('poll.settings_section_title')}</h4>

          {#if pollType === 'choice'}
            <label class="toggle-row">
              <input type="checkbox" bind:checked={multiple} />
              <span>{tFn('poll.multiple_choice_label')}</span>
            </label>

            {#if multiple}
              <div class="field sub-field" in:fly={{ y: -6, duration: 150 }}>
                <label for="max-choices">{tFn('poll.max_choices_label')}</label>
                <input id="max-choices" type="number" bind:value={maxChoices}
                  min="2" max="20" placeholder="Illimité" />
              </div>
            {/if}
          {/if}

          <label class="toggle-row">
            <input type="checkbox" bind:checked={anonymous} />
            <span>{tFn('poll.anonymous_votes_label')}</span>
          </label>

          <label class="toggle-row">
            <input type="checkbox" bind:checked={showResults} />
            <span>{tFn('poll.show_results_before_vote_label')}</span>
          </label>

          <div class="field">
            <label for="closes-at">{tFn('poll.auto_close_label')}</label>
            <input id="closes-at" type="datetime-local" bind:value={closesAt} />
          </div>

          <!-- Récapitulatif visuel -->
          <div class="settings-recap">
            <div class="recap-row">
              <span class="recap-icon">{TYPE_INFO.find(t => t.type === pollType)?.icon}</span>
              <span>Type : <strong>{TYPE_INFO.find(t => t.type === pollType)?.label}</strong></span>
            </div>
            {#if pollType === 'choice' && multiple}
              <div class="recap-row">
                <span class="recap-icon">☑</span>
                <span>{tFn('poll.recap_multiple_choices', { max: maxChoices ? ` (max ${maxChoices})` : '' })}</span>
              </div>
            {/if}
            {#if anonymous}
              <div class="recap-row">
                <span class="recap-icon">🔒</span>
                <span>{tFn('poll.anonymous_votes_label')}</span>
              </div>
            {/if}
            {#if closesAt}
              <div class="recap-row">
                <span class="recap-icon">⏱</span>
                <span>Ferme le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(closesAt))}</span>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

  </div>

  <!-- Footer -->
  {#if step === 'form'}
    <div class="creator-footer">
      <button class="btn-back" onclick={() => step = 'type'}>{tFn('poll.back_to_type_button')}</button>

      {#if error}
        <span class="footer-error">{error}</span>
      {/if}

      <button
        class="btn-submit"
        onclick={submit}
        disabled={!isValid() || submitting}
      >
        {submitting ? 'Création…' : '📊 Créer le sondage'}
      </button>
    </div>
  {/if}
</div>

<style>
  .creator-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.6);
    z-index: 900;
  }

  .creator-modal {
    position: fixed;
    inset: 0;
    margin: auto;
    width: min(92vw, 860px);
    max-height: 88vh;
    background: var(--bg-1, #16161e);
    border: 1px solid var(--border, #333);
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    z-index: 901;
    overflow: hidden;
  }

  /* ── Header ── */
  .creator-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border, #333);
    flex-shrink: 0;
  }
  .creator-header h2 { margin: 0; font-size: 1.05rem; font-weight: 700; }
  .btn-close {
    background: none; border: none;
    color: var(--text-muted, #888);
    cursor: pointer; font-size: 1rem; padding: 4px 8px;
  }
  .btn-close:hover { color: var(--text, #e0e0e0); }

  /* ── Body ── */
  .creator-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  /* ── Type grid ── */
  .type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }

  .type-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 16px;
    background: var(--bg-2, #1e1e2e);
    border: 2px solid var(--border, #333);
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: border-color .15s, background .15s;
  }
  .type-card:hover    { border-color: #7c3aed88; background: var(--bg-3, #252535); }
  .type-card.selected { border-color: #7c3aed; background: #7c3aed18; }

  .type-icon    { font-size: 1.8rem; }
  .type-label   { font-weight: 700; font-size: 1rem; }
  .type-desc    { font-size: 0.8rem; color: var(--text-muted, #888); margin: 0; }
  .type-example { font-size: 0.75rem; color: #a78bfa99; margin: 0; font-style: italic; }

  /* ── Form layout ── */
  .form-cols {
    display: grid;
    grid-template-columns: 1fr 260px;
    gap: 24px;
  }

  @media (max-width: 660px) {
    .form-cols { grid-template-columns: 1fr; }
  }

  .form-col-main,
  .form-col-settings { display: flex; flex-direction: column; gap: 14px; }

  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .optional { font-weight: 400; text-transform: none; letter-spacing: 0; }

  .field input, .field textarea {
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 7px;
    padding: 8px 10px;
    color: var(--text, #e0e0e0);
    font-size: 0.9rem;
    outline: none;
    transition: border-color .15s;
  }
  .field input:focus, .field textarea:focus { border-color: #7c3aed; }
  .field textarea { resize: vertical; min-height: 56px; }

  .sub-field { padding-left: 16px; }

  /* ── Bulk generator ── */
  .bulk-generator {
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bulk-generator h4 { margin: 0; font-size: 0.82rem; color: #a78bfa; }
  .bulk-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .btn-generate {
    padding: 7px 14px;
    background: #7c3aed22;
    border: 1px solid #7c3aed44;
    border-radius: 7px;
    color: #a78bfa;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.82rem;
    transition: background .15s;
  }
  .btn-generate:hover { background: #7c3aed33; }
  .btn-generate:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Options ── */
  .options-section { display: flex; flex-direction: column; gap: 8px; }
  .options-header  { display: flex; align-items: center; justify-content: space-between; }
  .options-header h4 { margin: 0; font-size: 0.82rem; font-weight: 700; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: .04em; }
  .btn-add-opt {
    padding: 4px 12px;
    background: #7c3aed22;
    border: 1px solid #7c3aed44;
    border-radius: 6px;
    color: #a78bfa;
    font-size: 0.78rem;
    cursor: pointer;
    transition: background .15s;
  }
  .btn-add-opt:hover { background: #7c3aed33; }

  .options-list { display: flex; flex-direction: column; gap: 6px; }

  .option-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .opt-num {
    width: 22px;
    font-size: 0.78rem;
    color: var(--text-muted, #888);
    text-align: center;
    flex-shrink: 0;
  }
  .opt-fields {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .opt-fields input {
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 7px;
    padding: 7px 10px;
    color: var(--text, #e0e0e0);
    font-size: 0.88rem;
    outline: none;
    transition: border-color .15s;
    width: 100%;
    box-sizing: border-box;
  }
  .opt-fields input:focus { border-color: #7c3aed; }
  .input-opt-desc { font-size: 0.8rem !important; color: var(--text-muted, #888) !important; }

  .sched-row-fields {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px;
  }
  .input-datetime { min-width: 0; }
  .input-label-sched { min-width: 0; }

  .opt-move { display: flex; flex-direction: column; gap: 2px; }
  .opt-move button {
    background: none;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 1px 4px;
    font-size: 0.7rem;
    border-radius: 3px;
    line-height: 1;
  }
  .opt-move button:disabled { opacity: 0.3; cursor: default; }
  .opt-move button:hover:not(:disabled) { background: var(--border, #333); }

  .opt-remove {
    background: none;
    border: none;
    color: #f8717188;
    cursor: pointer;
    padding: 4px 6px;
    font-size: 0.8rem;
    border-radius: 4px;
    transition: color .15s;
    flex-shrink: 0;
  }
  .opt-remove:hover { color: #f87171; }

  /* ── Settings column ── */
  .form-col-settings h4 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-muted, #888);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.88rem;
    padding: 8px 0;
  }
  .toggle-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #7c3aed; cursor: pointer; }

  .settings-recap {
    margin-top: 6px;
    padding: 12px;
    background: var(--bg-2, #1e1e2e);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .recap-row { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
  .recap-icon { width: 20px; text-align: center; }

  /* ── Footer ── */
  .creator-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-top: 1px solid var(--border, #333);
    flex-shrink: 0;
  }

  .btn-back {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    color: var(--text-muted, #888);
    cursor: pointer;
    font-size: 0.85rem;
    transition: border-color .15s;
  }
  .btn-back:hover { border-color: #7c3aed; color: var(--text, #e0e0e0); }

  .footer-error {
    flex: 1;
    font-size: 0.8rem;
    color: #f87171;
  }

  .btn-submit {
    margin-left: auto;
    padding: 8px 22px;
    background: #7c3aed;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    transition: opacity .15s, transform .1s;
  }
  .btn-submit:hover   { opacity: 0.9; }
  .btn-submit:active  { transform: scale(.97); }
  .btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
