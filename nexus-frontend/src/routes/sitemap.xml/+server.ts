import type { RequestHandler } from './$types';
import { apiFetch } from '$lib/api';

function escapeXml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function flattenCategories(cats: any[]): any[] {
	return cats.flatMap((c: any) => [c, ...flattenCategories(c.children ?? [])]);
}

function urlEntry(loc: string, lastmod?: string, priority = '0.7', changefreq = 'weekly') {
	return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export const GET: RequestHandler = async ({ fetch, url }) => {
	const origin = url.origin;
	const entries: string[] = [];

	// Pages statiques
	entries.push(urlEntry(origin, undefined, '1.0', 'daily'));
	entries.push(urlEntry(`${origin}/forum`, undefined, '0.9', 'daily'));

	try {
		const catsRes = await apiFetch(fetch, '/instance/categories');
		if (catsRes.ok) {
			const { categories } = await catsRes.json();
			const flat = flattenCategories(categories ?? []);

			// Page de chaque catégorie
			for (const cat of flat) {
				entries.push(urlEntry(`${origin}/forum/${cat.id}`, undefined, '0.8', 'daily'));
			}

			// Threads — fetch toutes les catégories en parallèle
			const threadBatches = await Promise.all(
				flat.map((cat: any) =>
					apiFetch(fetch, `/forums/threads?category_id=${cat.id}&limit=500`)
						.then(r => r.ok ? r.json() : { threads: [] })
						.then(j => (j.threads ?? []) as any[])
						.catch(() => [] as any[])
				)
			);

			for (const threads of threadBatches) {
				for (const t of threads) {
					const lastmod = new Date(t.updated_at || t.created_at).toISOString().split('T')[0];
					entries.push(urlEntry(`${origin}/forum/${t.category_id}/${t.id}`, lastmod, '0.7', 'weekly'));
				}
			}
		}
	} catch {
		// API indisponible — on retourne au moins les pages statiques
	}

	const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

	return new Response(sitemap, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
