<script lang="ts">
	// Rendu natif des agregats GoAccess. Aucun script inline, aucun `eval` :
	// c'est exactement ce qui rendait le rapport HTML de GoAccess inaffichable
	// derriere la CSP d'Olympus (`script-src` sans `unsafe-eval`).
	let { data } = $props()

	type Ligne = {
		nom: string
		methode: string | null
		coups: number
		pourcent: number
		visiteurs: number
		detail: Array<{ nom: string; coups: number; visiteurs: number }>
	}

	const SECTIONS: Array<{ clef: string; titre: string; note?: string; large?: boolean }> = [
		{ clef: 'requetes',     titre: 'Chemins les plus demandés', large: true },
		{ clef: 'hotes',        titre: 'Adresses', note: 'déplier pour voir les agents utilisés', large: true },
		{ clef: 'introuvables', titre: 'Introuvables (404)', note: 'un pic ici trahit un balayage' },
		{ clef: 'statuts',      titre: 'Codes de statut', note: 'déplier pour le détail' },
		{ clef: 'navigateurs',  titre: 'Navigateurs', note: 'déplier pour les versions' },
		{ clef: 'systemes',     titre: 'Systèmes' },
		{ clef: 'sites',        titre: 'Sites référents' },
		{ clef: 'heures',       titre: 'Répartition horaire' },
	]

	// Quelles lignes sont dépliées. Un simple ensemble, pas de script inline.
	let ouverts = $state(new Set<string>())
	function basculer(id: string) {
		const n = new Set(ouverts)
		n.has(id) ? n.delete(id) : n.add(id)
		ouverts = n
	}

	const fmt = (n: number) => n.toLocaleString('fr-FR')

	function octets(n: number): string {
		if (n < 1024) return `${n} o`
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Kio`
		return `${(n / 1024 ** 2).toFixed(1)} Mio`
	}

	/** Une couleur par famille de statut : le rouge doit sauter aux yeux. */
	function teinte(nom: string): string {
		if (/^5|5xx/.test(nom)) return 'rouge'
		if (/^4|4xx/.test(nom)) return 'orange'
		if (/^3|3xx/.test(nom)) return 'bleu'
		return 'vert'
	}
</script>

<svelte:head><title>Trafic web · Olympus</title></svelte:head>

<div class="entete">
	<div>
		<h1>Trafic web</h1>
		{#if data.general}
			<p class="periode">
				{data.general.debut} → {data.general.fin} · {octets(data.general.taille)} de journal analysés
			</p>
		{/if}
	</div>
	{#if data.genereIlYA !== null}
		<span class="fraicheur" title="Le rapport est régénéré chaque minute par nodyx-goaccess.timer">
			généré il y a {data.genereIlYA}s
		</span>
	{/if}
</div>

{#if data.indisponible || !data.general}
	<p class="vide">
		Rapport pas encore généré. Le minuteur <code>nodyx-goaccess.timer</code> tourne chaque
		minute ; il faut au moins une requête journalisée.
	</p>
{:else}
	<div class="chiffres">
		<div class="chiffre"><b>{fmt(data.general.requetes)}</b><span>requêtes</span></div>
		<div class="chiffre"><b>{fmt(data.general.visiteurs)}</b><span>visiteurs uniques</span></div>
		<div class="chiffre" title="Un ratio élevé signale un client qui martèle plutôt qu'un afflux">
			<b>{fmt(data.general.parVisiteur)}</b><span>requêtes / visiteur</span>
		</div>
		<div class="chiffre"><b>{fmt(data.general.fichiers)}</b><span>chemins distincts</span></div>
		<div class="chiffre" class:alerte={data.general.introuvables > 0}>
			<b>{fmt(data.general.introuvables)}</b><span>introuvables</span>
		</div>
		<div class="chiffre" class:alerte={data.general.echecs > 0}>
			<b>{fmt(data.general.echecs)}</b><span>requêtes en échec</span>
		</div>
	</div>

	<div class="grille">
		{#each SECTIONS as s}
			{@const lignes = (data.panneaux as Record<string, Ligne[]>)[s.clef] ?? []}
			{#if lignes.length}
				<section class="panneau" class:large={s.large}>
					<header>
						<h2>{s.titre}</h2>
						{#if s.note}<span class="note">{s.note}</span>{/if}
					</header>
					<table>
						<thead>
							<tr><th></th><th class="n">coups</th><th class="n">visit.</th><th></th></tr>
						</thead>
						<tbody>
							{#each lignes as l, i}
								{@const id = `${s.clef}-${i}`}
								{@const depliable = l.detail.length > 0}
								<tr class:depliable onclick={() => depliable && basculer(id)}>
									<td class="nom" title={l.nom}>
										{#if depliable}<span class="fleche" class:ouvert={ouverts.has(id)}>▸</span>{/if}
										{#if l.methode}<span class="methode">{l.methode}</span>{/if}
										<span class="txt {teinte(l.nom)}">{l.nom}</span>
									</td>
									<td class="n">{fmt(l.coups)}</td>
									<td class="n vis">{l.visiteurs ? fmt(l.visiteurs) : '·'}</td>
									<td class="barre">
										<!-- Largeur calculée côté serveur : rien que la CSP puisse bloquer. -->
										<span style="width:{Math.min(100, l.pourcent)}%"></span>
									</td>
								</tr>
								{#if depliable && ouverts.has(id)}
									{#each l.detail as d}
										<tr class="sous">
											<td class="nom" title={d.nom}>{d.nom}</td>
											<td class="n">{d.coups ? fmt(d.coups) : ''}</td>
											<td class="n vis">{d.visiteurs ? fmt(d.visiteurs) : ''}</td>
											<td></td>
										</tr>
									{/each}
								{/if}
							{/each}
						</tbody>
					</table>
				</section>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.entete { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
	h1 { margin: 0; font-size: 1.5rem; letter-spacing: -0.01em; }
	.periode { margin: 0.2rem 0 0; font-size: 0.72rem; color: #64748b; font-family: monospace; }
	.fraicheur { font-size: 0.7rem; color: #64748b; font-family: monospace; border: 1px solid #1e293b; border-radius: 999px; padding: 0.2rem 0.6rem; white-space: nowrap; }
	.vide { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
	code { background: #1e293b; padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; }

	.chiffres { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.7rem; margin-bottom: 1.5rem; }
	.chiffre { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.6rem; padding: 0.8rem 0.9rem; }
	.chiffre.alerte { border-color: #7f1d1d; }
	.chiffre.alerte b { color: #f87171; }
	.chiffre b { display: block; font-size: 1.35rem; font-variant-numeric: tabular-nums; line-height: 1.1; }
	.chiffre span { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

	.grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; }
	.panneau { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.6rem; padding: 1rem; min-width: 0; }
	.panneau.large { grid-column: 1 / -1; }
	.panneau header { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
	h2 { margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; }
	.note { font-size: 0.65rem; color: #475569; font-style: italic; }

	table { width: 100%; border-collapse: collapse; font-size: 0.78rem; table-layout: fixed; }
	thead th { font-size: 0.6rem; text-transform: uppercase; color: #475569; font-weight: 500; text-align: right; padding-bottom: 0.3rem; }
	thead th:first-child { text-align: left; }
	td { padding: 0.28rem 0.4rem; border-bottom: 1px solid rgba(30, 41, 59, 0.5); }
	tr.depliable { cursor: pointer; }
	tr.depliable:hover { background: rgba(99, 102, 241, 0.07); }
	tr.sous td { color: #64748b; font-size: 0.72rem; padding-left: 1.6rem; background: rgba(15, 23, 42, 0.6); }

	.nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
	.fleche { display: inline-block; color: #475569; transition: transform 0.12s; margin-right: 0.2rem; }
	.fleche.ouvert { transform: rotate(90deg); }
	.methode { display: inline-block; font-size: 0.6rem; padding: 0.05rem 0.3rem; margin-right: 0.35rem; border-radius: 0.2rem; background: #1e293b; color: #94a3b8; }
	.n { text-align: right; font-variant-numeric: tabular-nums; width: 3.6rem; color: #cbd5e1; }
	.vis { color: #64748b; width: 3rem; }
	.barre { width: 26%; }
	.barre span { display: block; height: 5px; border-radius: 3px; background: #6366f1; min-width: 2px; }

	.txt.rouge { color: #f87171; }
	.txt.orange { color: #fbbf24; }
	.txt.bleu { color: #60a5fa; }
</style>
