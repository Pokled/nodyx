import type { RequestHandler } from './$types';
import { apiFetch } from '$lib/api';

const BASE_URL  = 'https://nodyx.example.com';
const SITE_NAME = 'Nodyx';

export const GET: RequestHandler = async ({ fetch }) => {
	const items: string[] = [];

	try {
		const commRes = await apiFetch(fetch, '/communities');
		const { communities } = await commRes.json();

		for (const community of communities ?? []) {
			const catRes = await apiFetch(fetch, `/forums/${community.slug}`);
			const { categories } = await catRes.json();

			for (const category of categories ?? []) {
				const threadRes = await apiFetch(fetch, `/forums/threads?category_id=${category.id}&limit=20`);
				const { threads } = await threadRes.json();

				for (const thread of threads ?? []) {
					items.push(`
    <item>
      <title><![CDATA[${thread.title}]]></title>
      <link>${BASE_URL}/forum/${category.slug ?? category.id}/${thread.slug ?? thread.id}</link>
      <guid isPermaLink="true">${BASE_URL}/forum/${category.slug ?? category.id}/${thread.slug ?? thread.id}</guid>
      <pubDate>${new Date(thread.created_at).toUTCString()}</pubDate>
      <author>${thread.author_username}</author>
      <category><![CDATA[${category.name}]]></category>
      <description><![CDATA[Sujet posté par ${thread.author_username} dans ${category.name}, ${thread.post_count} réponse(s)]]></description>
    </item>`);
				}
			}
		}
	} catch {
		// API indisponible — feed vide mais valide
	}

	// Tri chronologique décroissant (les items sont déjà triés par l'API)
	const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME} · Derniers sujets</title>
    <link>${BASE_URL}</link>
    <description>Les dernières discussions du forum ${SITE_NAME}</description>
    <language>fr-FR</language>
    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
    <ttl>60</ttl>
    ${items.join('')}
  </channel>
</rss>`;

	return new Response(feed, {
		headers: {
			'Content-Type': 'application/rss+xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
