import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
	const token = cookies.get('token') ?? null;

	const res  = await apiFetch(fetch, `/forums/threads/${params.thread}`);
	const json = await res.json();

	if (!res.ok) {
		error(res.status, json.error ?? 'Thread introuvable');
	}

	// Redirect UUID-based URLs to canonical slug URL (301 for SEO)
	const thread = json.thread;
	if (thread.slug && params.thread !== thread.slug) {
		redirect(301, `/forum/${params.category}/${thread.slug}`);
	}

	// Charger le sondage lié à ce thread (s'il existe)
	let poll: any = null;
	if (token) {
		const pollRes = await apiFetch(fetch, `/polls?thread_id=${thread.id}&limit=1`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (pollRes.ok) {
			const pollJson = await pollRes.json();
			poll = pollJson.polls?.[0] ?? null;
		}
	}

	return { thread: json.thread, posts: json.posts, poll, token };
};

export const actions: Actions = {

	// ── Publier une réponse ───────────────────────────────────────────────
	reply: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form    = await request.formData();
		const content = form.get('content') as string;

		const res  = await apiFetch(fetch, '/forums/posts', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ thread_id: params.thread, content })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { replyError: json.error });
		}
	},

	// ── Éditer un post ────────────────────────────────────────────────────
	editPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form    = await request.formData();
		const postId  = form.get('post_id') as string;
		const content = form.get('content') as string;

		const res = await apiFetch(fetch, `/forums/posts/${postId}`, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ content })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { editError: json.error });
		}
	},

	// ── Supprimer un post ─────────────────────────────────────────────────
	deletePost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form   = await request.formData();
		const postId = form.get('post_id') as string;

		await apiFetch(fetch, `/forums/posts/${postId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` }
		});
	},

	// ── Éditer le titre du thread ─────────────────────────────────────────
	editTitle: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form  = await request.formData();
		const title = (form.get('title') as string).trim();

		if (!title) return fail(400, { editTitleError: 'Titre requis' });

		const res  = await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title })
		});

		if (!res.ok) {
			const json = await res.json();
			return fail(res.status, { editTitleError: json.error });
		}
	},

	// ── Épingler / désépingler ────────────────────────────────────────────
	pinThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form     = await request.formData();
		const isPinned = form.get('is_pinned') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_pinned: isPinned })
		});
	},

	// ── Verrouiller / déverrouiller ───────────────────────────────────────
	lockThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form     = await request.formData();
		const isLocked = form.get('is_locked') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_locked: isLocked })
		});
	},

	// ── Promouvoir / rétrograder en article mis en avant ─────────────────
	featureThread: async ({ fetch, request, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		const form       = await request.formData();
		const isFeatured = form.get('is_featured') === 'true';

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ is_featured: isFeatured })
		});
	},

	// ── Supprimer le thread ───────────────────────────────────────────────
	deleteThread: async ({ fetch, params, cookies }) => {
		const token = cookies.get('token');
		if (!token) error(401, 'Non connecté');

		await apiFetch(fetch, `/forums/threads/${params.thread}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ delete: true })
		});

		redirect(303, `/forum/${params.category}`);
	},

	// ── Réagir à un post ─────────────────────────────────────────────────
	reactPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		const form   = await request.formData();
		const postId = form.get('post_id') as string;
		const emoji  = form.get('emoji')   as string;

		await apiFetch(fetch, `/forums/posts/${postId}/reactions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ emoji })
		});
	},

	// ── Remercier un post ─────────────────────────────────────────────────
	thankPost: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token');
		if (!token) return fail(401, { error: 'Non connecté' });

		const form   = await request.formData();
		const postId = form.get('post_id') as string;

		await apiFetch(fetch, `/forums/posts/${postId}/thanks`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` }
		});
	},
};
