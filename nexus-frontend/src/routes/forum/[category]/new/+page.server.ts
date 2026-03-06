import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token');
	if (!token) {
		redirect(303, `/auth/login?redirectTo=/forum/${params.category}/new`);
	}

	// Load available tags for this community
	const tagsRes = await apiFetch(fetch, '/instance/tags');
	const { tags } = tagsRes.ok ? await tagsRes.json() : { tags: [] };

	return { tags, token };
};

export const actions: Actions = {
	default: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) {
			redirect(303, '/auth/login');
		}

		const form    = await request.formData();
		const title   = (form.get('title')   as string).trim();
		const content = (form.get('content') as string).trim();
		const tagIds  = form.getAll('tag_ids') as string[];

		if (!title || !content) {
			return fail(400, { error: 'Le titre et le contenu sont obligatoires.' });
		}

		const pollJson = form.get('poll_json') as string | null;

		const res  = await apiFetch(fetch, '/forums/threads', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				category_id: params.category,
				title,
				content,
				tag_ids: tagIds.filter(Boolean),
			})
		});
		const json = await res.json();

		if (!res.ok) {
			return fail(res.status, { error: json.error });
		}

		// Si un sondage est joint, le créer avec le thread_id
		if (pollJson) {
			try {
				const pollData = JSON.parse(pollJson);
				pollData.thread_id = json.thread.id;
				pollData.channel_id = null;
				await apiFetch(fetch, '/polls', {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify(pollData),
				});
			} catch {
				// Sondage non critique : on redirige quand même
			}
		}

		redirect(303, `/forum/${params.category}/${json.thread.id}`);
	}
};
