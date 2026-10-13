/**
 * Fil d'Ariane de la barre du haut, à partir de l'adresse de la page.
 *
 * Une page absente de la table n'affiche AUCUN fil plutôt que le nom brut de
 * son dossier : c'est ce repli qui affichait « Auth » sur la page de connexion,
 * « Canvas », « Whisper »…, jamais traduits.
 */

export interface Miette { label: string; href?: string }

type Traduire = (cle: string) => string

interface Contexte {
  tFn: Traduire
  /** `page.data` : catégorie et sujet du forum. */
  data?: { category?: { name?: string; slug?: string; id?: string }; thread?: { title?: string } } | null
  /** Paramètre `channel` de l'adresse, et les salons connus, pour le chat. */
  canal?: string | null
  salons?: Array<{ id: string; name: string; type?: string }>
}

/** Pages à une seule miette : préfixe d'adresse → clé de traduction. L'ordre compte (préfixes longs d'abord). */
const PAGES: Array<[string, string]> = [
  ['/users/me/edit',        'nav.edit_profile'],
  ['/auth/register',        'auth.register.title'],
  ['/register',             'auth.register.title'],
  ['/auth/forgot-password', 'auth.forgot_password.title'],
  ['/auth/verify',          'auth.verify_email.title'],
  ['/reset-password',       'reset_pwd.title'],
  ['/auth',                 'auth.login.title'],
  ['/login',                'auth.login.title'],
  ['/dm',                   'nav.dm'],
  ['/calendar',             'nav.calendar'],
  ['/discover',             'nav.discover'],
  ['/admin',                'nav.admin'],
  ['/notifications',        'nav.notifications'],
  ['/settings',             'nav.settings'],
  ['/communities',          'nav.communities'],
  ['/polls',                'nav.polls'],
  ['/tasks',                'nav.tasks'],
  ['/wiki',                 'nav.wiki'],
  ['/library',              'nav.library'],
  ['/musique',              'nav.music'],
  ['/search',               'nav.search'],
  ['/garden',               'nav.garden'],
  ['/canvas',               'nav.canvas'],
  ['/feed',                 'nav.feed'],
  ['/status',               'nav.feed'],
  ['/members',              'nav.members'],
  ['/translate',            'translate.title'],
  ['/about',                'user.tab_about'],
  ['/reputation',           'reprings.title'],
  ['/whisper',              'whisper.default_name'],
  ['/soundboard',           'soundboard.eyebrow'],
  ['/banned',               'banned.title'],
  ['/cert-methodology',     'cert.h1'],
]

const commence = (chemin: string, prefixe: string) => chemin === prefixe || chemin.startsWith(prefixe + '/')

export function filAriane(chemin: string, { tFn, data, canal, salons = [] }: Contexte): Miette[] {
  if (chemin === '/') return []

  if (commence(chemin, '/forum')) {
    const miettes: Miette[] = [{ label: tFn('nav.forum'), href: '/forum' }]
    if (data?.category?.name) {
      const nom = data.category.name.replace(/^\p{Emoji}\s*/u, '')
      miettes.push({ label: nom, href: `/forum/${data.category.slug ?? data.category.id}` })
    }
    if (data?.thread?.title) miettes.push({ label: data.thread.title })
    return miettes
  }

  if (commence(chemin, '/chat')) {
    const miettes: Miette[] = [{ label: tFn('nav.chat') }]
    const salon = canal ? salons.find((s) => s.id === canal) : undefined
    if (salon) miettes.push({ label: (salon.type === 'voice' ? '🔊 ' : '# ') + salon.name })
    return miettes
  }

  for (const [prefixe, cle] of PAGES) {
    if (commence(chemin, prefixe)) return [{ label: tFn(cle) }]
  }

  // Profil d'un membre : son nom d'utilisateur, tel quel.
  if (commence(chemin, '/users')) {
    const nom = chemin.split('/')[2]
    return nom ? [{ label: decodeURIComponent(nom) }] : []
  }

  return []
}
