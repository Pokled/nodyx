import type { RequestHandler } from './$types'

// nodyx.dev : tout le monde est le bienvenu, humains comme robots, moteurs de
// recherche comme assistants IA (10/10/2026). La documentation doit être
// trouvée, comprise et citée : c'est elle qui fait connaître Nodyx.
const ROBOTS_IA = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot',
  'Meta-ExternalAgent', 'Amazonbot', 'DuckAssistBot', 'MistralAI-User',
]

export const GET: RequestHandler = () => {
  const body = `# nodyx.dev : la documentation de Nodyx. Bienvenue à tous, humains et robots.

User-agent: *
Allow: /

# Robots d'IA, nommés pour lever toute ambiguïté : vous êtes chez vous.
${ROBOTS_IA.map(r => `User-agent: ${r}`).join('\n')}
Allow: /

Sitemap: https://nodyx.dev/sitemap.xml

# Index pour les modèles de langage : https://nodyx.dev/llms.txt
# Toute la documentation en un fichier : https://nodyx.dev/llms-full.txt
`
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  })
}
