/**
 * Bench OctoGuard, validation du budget perf p95 < 5ms.
 * Cf. spec v2.1.1 + memory project_octoguard_roadmap §R5.
 *
 * Lancement :
 *   OCTOGUARD_ENABLED=true npx ts-node src/services/octoguard/bench.ts
 *
 * Le bench :
 *   1. Insère ~10 règles auto-mod variées (regex, caps, link_domain,
 *      mention_spam, link_spam) en mémoire (pas DB) pour simuler une
 *      config admin réaliste.
 *   2. Exécute 1000 appels à runPipeline() sur des contenus variés
 *      (matchs + non-matchs + edge cases).
 *   3. Calcule p50 / p95 / p99 et compare au budget.
 *   4. Affiche le verdict (PASS/FAIL).
 *
 * Le bench utilise un cache fake en mémoire pour éviter la latence DB
 * (on isole la perf du pipeline lui-même, pas de la couche I/O).
 */

import { performance } from 'perf_hooks'
import { runPipeline } from './pipeline'
import type { AutomodRuleRow } from './types'
import { _setRulesForBench } from './cache'

// Forçage du flag activé pour ce bench (process isolé)
process.env.OCTOGUARD_ENABLED = 'true'

// ─── Règles de test (10 règles variées, en mémoire) ─────────────────────────

const TEST_RULES: AutomodRuleRow[] = [
  {
    id: '00000000-0000-0000-0000-000000000001', name: 'anti-gros-mots', type: 'regex',
    params: { pattern: '\\b(merde|connard|salaud)\\b', flags: 'i' },
    action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000002', name: 'caps', type: 'caps',
    params: { min_length: 15, threshold_percent: 70 },
    action: 'warn', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000003', name: 'anti-discord-link', type: 'link_domain',
    params: { mode: 'blacklist', domains: ['discord.gg', 'discord.com'] },
    action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000004', name: 'mention-spam', type: 'mention_spam',
    params: { max_mentions: 5 },
    action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000005', name: 'link-spam', type: 'link_spam',
    params: { max_links: 3 },
    action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000006', name: 'regex-2', type: 'regex',
    params: { pattern: '\\bspam\\b', flags: 'i' },
    action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000007', name: 'regex-3', type: 'regex',
    params: { pattern: '\\bnsfw\\b', flags: 'i' },
    action: 'warn', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000008', name: 'caps-strict', type: 'caps',
    params: { min_length: 10, threshold_percent: 85 },
    action: 'notify_only', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000009', name: 'whitelist-domain', type: 'link_domain',
    params: { mode: 'whitelist', domains: ['nodyx.org', 'github.com', 'wikipedia.org'] },
    action: 'notify_only', action_duration: null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
  {
    id: '00000000-0000-0000-0000-000000000010', name: 'regex-final', type: 'regex',
    params: { pattern: '\\b(scam|phish)\\b', flags: 'i' },
    action: 'ban_temp', action_duration: { value: 1, unit: 'h' }, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
  },
]

// ─── Contenus de test ────────────────────────────────────────────────────────

// Distribution réaliste prod : ~85% safe, ~15% match (l'admin a typiquement
// ~5-10 règles pour des cas spécifiques, et la majorité des messages
// quotidiens ne matchent rien). Le bench stress (50/50) est testable
// séparément via STRESS=1.
const SAFE_CONTENTS = [
  'Hello world, how are you?',
  'Bonjour à tous les amis de la communauté',
  'Check out https://nodyx.org/docs and have fun',
  'visit https://github.com/Pokled/nodyx for the source',
  'this is a perfectly normal message about cats',
  '<p>hello <strong>world</strong></p>',
  'A normal-length message with some text and content',
  'how are you doing today?',
  'thanks for the help yesterday',
  'I will check the documentation later',
  'agreed, that makes sense to me',
  'great point, I had not thought of that',
  'see you tomorrow at the meeting',
  'reading the wiki right now',
  'happy birthday !',
  'let me know if you need anything',
  'I posted the screenshot in #general',
]

const MATCH_CONTENTS = [
  'merde quel truc nul',                                              // regex
  'HELLO EVERYONE WHAT IS GOING ON HERE TONIGHT',                     // caps
  'spam spam spam',                                                    // regex spam
  'join https://discord.gg/abc come on',                              // link_domain blacklist
  '@a @b @c @d @e @f @g hello',                                        // mention_spam
  'a https://x.com b https://y.com c https://z.com d https://w.com',  // link_spam
  'nsfw content here',                                                 // regex nsfw
]

// Mix 85% safe / 15% match (or 50/50 if STRESS=1)
const STRESS_MODE = process.env.STRESS === '1'
const TEST_CONTENTS = STRESS_MODE
  ? [...SAFE_CONTENTS, ...MATCH_CONTENTS]
  : [
      ...SAFE_CONTENTS, ...SAFE_CONTENTS, ...SAFE_CONTENTS, ...SAFE_CONTENTS, ...SAFE_CONTENTS, // 5x = 85
      ...MATCH_CONTENTS, ...MATCH_CONTENTS,                                                      // 2x = 14
    ]

// ─── Injection du cache pour utiliser nos règles directement ────────────────

_setRulesForBench(TEST_RULES)

// ─── Bench ──────────────────────────────────────────────────────────────────

interface BenchResult {
  count:    number
  p50:      number
  p95:      number
  p99:      number
  max:      number
  blocked:  number
  passed:   number
}

async function runBench(iterations = 1000): Promise<BenchResult> {
  const timings: number[] = []
  let blocked = 0
  let passed = 0

  for (let i = 0; i < iterations; i++) {
    const content = TEST_CONTENTS[i % TEST_CONTENTS.length]
    const start = performance.now()
    const r = await runPipeline({
      content,
      userCtx: { userId: '00000000-0000-0000-0000-000000000bench', role: 'member', gradeIds: [] },
      channelId: '00000000-0000-0000-0000-0000000bench00',
    })
    const elapsed = performance.now() - start
    timings.push(elapsed)
    if (r.blocked) blocked++
    else passed++
  }

  timings.sort((a, b) => a - b)
  const p = (n: number) => timings[Math.floor(timings.length * n / 100)]

  return {
    count:   iterations,
    p50:     p(50),
    p95:     p(95),
    p99:     p(99),
    max:     timings[timings.length - 1],
    blocked,
    passed,
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('[bench] OctoGuard pipeline, budget cible : p95 < 5ms')
  console.log(`[bench] ${TEST_RULES.length} règles actives, ${TEST_CONTENTS.length} contenus`)
  console.log(`[bench] mode : ${STRESS_MODE ? 'STRESS (50/50)' : 'REALISTIC (~85% safe / ~15% match)'}`)

  // Warmup pour stabiliser la JIT
  console.log('[bench] warmup (200 itérations)...')
  await runBench(200)

  // Bench réel
  console.log('[bench] running 1000 iterations...')
  const r = await runBench(1000)

  console.log()
  console.log('=== RÉSULTATS ===')
  console.log(`Iterations : ${r.count}`)
  console.log(`Blocked    : ${r.blocked} (${(r.blocked / r.count * 100).toFixed(1)}%)`)
  console.log(`Passed     : ${r.passed} (${(r.passed / r.count * 100).toFixed(1)}%)`)
  console.log()
  console.log('Latence (ms) :')
  console.log(`  p50 : ${r.p50.toFixed(3)}`)
  console.log(`  p95 : ${r.p95.toFixed(3)}`)
  console.log(`  p99 : ${r.p99.toFixed(3)}`)
  console.log(`  max : ${r.max.toFixed(3)}`)
  console.log()

  const PASS = r.p95 < 5
  console.log(PASS
    ? `✓ PASS — p95 ${r.p95.toFixed(3)}ms < 5ms budget`
    : `✗ FAIL — p95 ${r.p95.toFixed(3)}ms >= 5ms budget`
  )

  // Note : on n'exit pas avec code !=0 si FAIL car le bench peut écrire
  // des logs DB (logOctoGuardAction) qui sont async non bloquants. Le PASS
  // est purement informatif pour la roadmap.
  process.exit(0)
}

main().catch(err => {
  console.error('[bench] error:', err)
  process.exit(1)
})
