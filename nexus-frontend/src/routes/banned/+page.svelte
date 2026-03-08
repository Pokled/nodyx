<script lang="ts">
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';

	const communityName = $derived($page.data.communityName ?? 'cette communauté');
</script>

<svelte:head>
	<title>Accès refusé</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 flex items-center justify-center px-4">
	<div class="max-w-md w-full text-center">
		<div class="w-20 h-20 rounded-full bg-red-900/30 border border-red-800/60 flex items-center justify-center mx-auto mb-6">
			<svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 115.636 5.636m12.728 12.728L5.636 5.636" />
			</svg>
		</div>

		<h1 class="text-2xl font-bold text-white mb-3">Accès refusé</h1>
		<p class="text-gray-400 text-sm leading-relaxed mb-8">
			Votre compte a été banni de <span class="text-white font-medium">{communityName}</span>.
			Si vous pensez qu'il s'agit d'une erreur, contactez un administrateur.
		</p>

		<form method="POST" action="?/logout" use:enhance>
			<button
				type="submit"
				class="px-6 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors border border-gray-700"
			>
				Se déconnecter
			</button>
		</form>
	</div>
</div>
