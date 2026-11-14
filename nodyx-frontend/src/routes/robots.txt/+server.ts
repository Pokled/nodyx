// robots.txt, propre à CHAQUE instance. Avant, un fichier statique identique
// partout : son « Sitemap: /sitemap.xml » RELATIF est ignoré par les moteurs (la
// norme exige une adresse complète), et chaque groupe de robots d'IA remplaçait
// les interdictions du groupe « * » au lieu de s'y ajouter (un robot ne lit QUE
// le groupe qui le nomme) : GPTBot et les autres pouvaient explorer /auth/ et /api/.
import type { RequestHandler } from './$types'

// Explicitement bienvenus : moteurs de recherche et assistants d'IA. Le savoir
// d'une communauté publique appartient à internet.
const BOTS = [
	'Googlebot', 'Bingbot', 'DuckDuckBot', 'Qwantbot', 'YandexBot', 'Applebot', 'Applebot-Extended',
	'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
	'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'meta-externalagent', 'Amazonbot',
	'DuckAssistBot', 'MistralAI-User', 'CCBot', 'cohere-ai',
]

// Rien à lire pour un robot : comptes, réglages, espaces réservés aux membres,
// recherche (pages sans fin), API (JSON, pas des pages).
const PRIVATE = [
	'/api/', '/auth/', '/admin', '/login', '/register', '/reset-password', '/settings',
	'/notifications', '/dm', '/chat', '/search', '/overlay/', '/banned', '/whisper', '/canvas',
]

export const GET: RequestHandler = ({ url }) => {
	const rules = ['Allow: /', ...PRIVATE.map(p => `Disallow: ${p}`)].join('\n')
	const body = [
		'# Public community content: search engines and AI assistants are welcome.',
		'# Members-only areas (chat, private messages, settings) are not crawlable anyway.',
		'',
		'User-agent: *',
		rules,
		'',
		BOTS.map(b => `User-agent: ${b}`).join('\n'),
		rules,
		'',
		`Sitemap: ${url.origin}/sitemap.xml`,
		'',
		'# Feed: ' + `${url.origin}/rss.xml`,
		'# Summary for language models: ' + `${url.origin}/llms.txt`,
		'',
	].join('\n')
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
