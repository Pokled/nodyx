import type { PageServerLoad } from './$types';
import { readFile } from 'fs/promises';
import path from 'path';

interface Track {
	title: string;
	description?: string;
	audio: string;
	cover?: string;
}

interface Category {
	slug: string;
	title: string;
	description?: string;
	image?: string | null;
	tracks: Track[];
}

interface Project {
	slug: string;
	title: string;
	description?: string;
	categories: Category[];
}

// Catalogue édité à la main, hors de src/ et de static/ : le modifier prend
// effet au prochain chargement de page, sans build ni redémarrage.
// Voir content/README-musique.md.
const CATALOG_PATH = path.join(process.cwd(), 'content', 'musique.json');

export const load: PageServerLoad = async () => {
	try {
		const raw = await readFile(CATALOG_PATH, 'utf-8');
		const data = JSON.parse(raw) as { projects: Project[] };
		return { projects: data.projects ?? [] };
	} catch {
		return { projects: [] as Project[] };
	}
};
