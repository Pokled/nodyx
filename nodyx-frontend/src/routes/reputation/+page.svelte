<svelte:head>
	<title>Comment fonctionne la réputation — Nodyx</title>
	<meta name="description" content="Explication complète et transparente du système de réputation Nodyx : Longévité, Qualité, Engagement." />
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-12 space-y-10">

	<!-- Header -->
	<div>
		<a href="javascript:history.back()" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-8">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
			</svg>
			Retour
		</a>

		<h1 class="text-3xl font-black text-white mb-3">Comment fonctionne la réputation ?</h1>
		<p class="text-gray-400 leading-relaxed">
			Ici, rien n'est caché. Voici exactement comment votre score de réputation est calculé —
			la formule, ce qu'elle mesure, et pourquoi elle est conçue comme ça.
		</p>
	</div>

	<!-- Philosophy block -->
	<div class="border-l-2 border-indigo-500 pl-5 py-1">
		<p class="text-sm text-gray-300 leading-relaxed italic">
			"La plupart des réseaux sociaux cachent leurs algorithmes parce qu'ils optimisent
			pour votre attention, pas pour votre contribution. Nodyx n'a pas d'intérêt à vous manipuler.
			Ce score n'est pas là pour vous noter — il est là pour vous montrer votre trajet."
		</p>
	</div>

	<!-- Score global -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-white">Le score global</h2>
		<div class="bg-gray-900 border border-gray-800 p-5 space-y-3">
			<p class="text-sm text-gray-300">
				Le pourcentage affiché au centre des anneaux est la <strong class="text-white">moyenne simple</strong>
				des trois dimensions ci-dessous :
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-indigo-300">
				score = (Longévité + Qualité + Engagement) ÷ 3
			</div>
			<p class="text-xs text-gray-500">
				Chaque dimension est indépendante et plafonnée à 100 %.
				Un score global de 100 % demande du temps, de la régularité, et de l'implication — pas de l'optimisation.
			</p>
		</div>
	</section>

	<!-- Metric 1 — Longévité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-indigo-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">Longévité</h2>
			<span class="text-xs text-gray-500 ml-auto">Anneau extérieur</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-4">
			<p class="text-sm text-gray-300">
				Mesure <strong class="text-white">depuis combien de temps vous faites partie de cette communauté</strong>.
				Un membre présent depuis un an a une longévité de 100 %.
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-indigo-300">
				Longévité = min(1, jours_depuis_inscription ÷ 365)
			</div>
			<table class="w-full text-xs text-gray-400 border-collapse">
				<thead>
					<tr class="border-b border-gray-800">
						<th class="text-left py-2 font-medium text-gray-500">Ancienneté</th>
						<th class="text-right py-2 font-medium text-gray-500">Score</th>
					</tr>
				</thead>
				<tbody>
					{#each [['1 semaine','2 %'],['1 mois','8 %'],['3 mois','25 %'],['6 mois','50 %'],['1 an ou plus','100 %']] as [label, score]}
						<tr class="border-b border-gray-800/50">
							<td class="py-2 text-gray-300">{label}</td>
							<td class="py-2 text-right font-mono text-indigo-300">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-gray-600">
				Cette dimension ne peut pas être accélérée. Elle récompense simplement la fidélité dans le temps.
			</p>
		</div>
	</section>

	<!-- Metric 2 — Qualité -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-violet-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">Qualité</h2>
			<span class="text-xs text-gray-500 ml-auto">Anneau intermédiaire</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-5">
			<p class="text-sm text-gray-300">
				Mesure la <strong class="text-white">pertinence réelle de vos contributions</strong>
				via les Merci reçus, pondérés par un coefficient de décroissance temporelle.
				Un Merci récent pèse plus qu'un Merci ancien.
			</p>

			<!-- Formula display -->
			<div class="bg-gray-950 border border-gray-800 px-6 py-5 flex items-center justify-center">
				<div class="flex items-center gap-3 text-violet-300 select-none" aria-label="Q = (somme des Merci reçus / somme des Posts totaux) × Poids(λ)">
					<!-- Q = -->
					<span class="text-xl font-bold italic">Q</span>
					<span class="text-lg text-gray-500">=</span>
					<!-- Fraction -->
					<div class="flex flex-col items-center gap-0.5">
						<span class="text-sm font-medium pb-1.5 border-b border-violet-400/60 px-2 whitespace-nowrap">
							∑ Merci<sub class="text-[10px] ml-0.5">reçus</sub>
						</span>
						<span class="text-sm font-medium pt-1.5 px-2 whitespace-nowrap text-violet-400/80">
							∑ Posts<sub class="text-[10px] ml-0.5">totaux</sub>
						</span>
					</div>
					<!-- × Poids(λ) -->
					<span class="text-lg text-gray-500">×</span>
					<span class="text-sm font-medium whitespace-nowrap">
						Poids(<span class="italic">λ</span>)
					</span>
				</div>
			</div>

			<!-- Lambda explanation -->
			<div class="space-y-3">
				<p class="text-sm font-semibold text-white">Le coefficient Poids(λ) — décroissance temporelle</p>
				<p class="text-sm text-gray-400 leading-relaxed">
					Chaque Merci reçu est pondéré par sa date. Plus un Merci est ancien, moins il pèse.
					La décroissance suit une loi exponentielle :
				</p>
				<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-violet-300 flex items-center gap-3 flex-wrap">
					<span>poids(t)</span>
					<span class="text-gray-600">=</span>
					<span>e<sup class="text-xs">−λt</sup></span>
				</div>
				<ul class="text-xs text-gray-500 space-y-1.5 pl-4">
					<li class="list-disc"><strong class="text-gray-400">t</strong> = temps écoulé depuis le Merci, en jours</li>
					<li class="list-disc"><strong class="text-gray-400">λ</strong> = coefficient de décroissance — configurable par l'administrateur de l'instance</li>
					<li class="list-disc">λ élevé → les anciens Merci comptent très peu (mémoire courte)</li>
					<li class="list-disc">λ proche de 0 → tous les Merci pèsent pareil (mémoire longue)</li>
				</ul>
			</div>

			<!-- Merci system note -->
			<div class="border-l-2 border-violet-500/40 pl-4 py-1">
				<p class="text-xs text-gray-500 leading-relaxed">
					<strong class="text-gray-400">Le système Merci est en cours de déploiement.</strong>
					En attendant, la Qualité est approximée par les points XP accumulés
					(<code class="text-violet-400">min(1, XP ÷ 500)</code>).
					Dès que les données Merci seront disponibles, la formule complète entrera en vigueur
					automatiquement.
				</p>
			</div>
		</div>
	</section>

	<!-- Metric 3 — Engagement -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			<div class="w-3 h-3 rounded-full bg-teal-400 shrink-0"></div>
			<h2 class="text-lg font-bold text-white">Engagement</h2>
			<span class="text-xs text-gray-500 ml-auto">Anneau intérieur</span>
		</div>

		<div class="bg-gray-900 border border-gray-800 p-5 space-y-4">
			<p class="text-sm text-gray-300">
				Mesure <strong class="text-white">si vous initiez des discussions</strong> ou si vous vous contentez
				de répondre. Créer des fils de discussion est doublement valorisé.
			</p>
			<div class="bg-gray-950 border border-gray-800 px-4 py-3 font-mono text-sm text-teal-300">
				Engagement = min(1, (threads × 2) ÷ (posts + threads))
			</div>
			<table class="w-full text-xs text-gray-400 border-collapse">
				<thead>
					<tr class="border-b border-gray-800">
						<th class="text-left py-2 font-medium text-gray-500">Situation</th>
						<th class="text-right py-2 font-medium text-gray-500">Score</th>
					</tr>
				</thead>
				<tbody>
					{#each [
						['Aucune activité','0 %'],
						['Uniquement des réponses (0 thread)','0 %'],
						['1 thread + 10 posts','18 %'],
						['5 threads + 5 posts','100 %'],
						['Uniquement des threads (0 post)','100 %'],
					] as [label, score]}
						<tr class="border-b border-gray-800/50">
							<td class="py-2 text-gray-300">{label}</td>
							<td class="py-2 text-right font-mono text-teal-300">{score}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="text-xs text-gray-600">
				L'objectif n'est pas de créer des threads pour créer des threads —
				mais de valoriser ceux qui enrichissent la communauté en ouvrant des espaces de discussion.
			</p>
		</div>
	</section>

	<!-- Anti-gaming block -->
	<section class="space-y-4">
		<h2 class="text-lg font-bold text-white">Ce score peut-il être manipulé ?</h2>
		<div class="bg-gray-900 border border-gray-800 p-5 space-y-3">
			<p class="text-sm text-gray-300">
				<strong class="text-white">Pas vraiment.</strong> La Longévité est strictement temporelle —
				impossible d'accélérer le temps. La Qualité demande de l'investissement réel sur la durée.
				L'Engagement peut être "optimisé" en créant des threads vides, mais la communauté s'en aperçoit
				et ces threads n'ont aucune valeur réelle.
			</p>
			<p class="text-sm text-gray-300">
				De plus, ce score n'est pas un classement. Il n'y a pas de récompense cachée à avoir 100 %.
				C'est simplement un reflet honnête de votre trajet ici.
			</p>
		</div>
	</section>

	<!-- Evolution note -->
	<section class="space-y-3">
		<h2 class="text-lg font-bold text-white">Ce système va évoluer</h2>
		<p class="text-sm text-gray-400 leading-relaxed">
			À terme, d'autres dimensions pourront être ajoutées par les administrateurs de chaque instance
			(aide aux autres membres, participation aux événements, modération…).
			Chaque évolution sera documentée ici.
			Les formules resteront toujours publiques et lisibles.
		</p>
	</section>

	<!-- Footer link -->
	<div class="border-t border-gray-800 pt-8 text-center">
		<p class="text-xs text-gray-600">
			Nodyx est open-source sous licence AGPL-3.0.
			Le code qui calcule ce score est lisible par n'importe qui sur
			<a href="https://github.com/Pokled/Nexus" target="_blank" rel="noopener noreferrer"
			   class="text-indigo-400 hover:text-indigo-300 transition-colors">GitHub</a>.
		</p>
	</div>

</div>
