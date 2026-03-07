import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')

	const headers = { Authorization: `Bearer ${token}` }

	const [msgsRes, convsRes] = await Promise.all([
		apiFetch(fetch, `/dm/conversations/${params.id}/messages`, { headers }),
		apiFetch(fetch, '/dm/conversations', { headers }),
	])

	if (msgsRes.status === 403) error(403, 'Conversation introuvable')
	if (!msgsRes.ok) error(msgsRes.status, 'Erreur chargement messages')

	const { messages } = await msgsRes.json()
	const { conversations } = convsRes.ok ? await convsRes.json() : { conversations: [] }

	// Trouver les infos de la conversation courante
	const conversation = conversations.find((c: { id: string }) => c.id === params.id) ?? null

	return { messages, conversations, conversation, conversationId: params.id, token }
}
