<script lang="ts">
	// Rendu natif des agregats GoAccess. Aucun script inline, aucun `eval` :
	// c'est precisement ce qui rendait le rapport HTML de GoAccess inaffichable
	// derriere la CSP d'Olympus.
	let { data } = $props()

	const PANNEAUX: Array<{ clef: keyof typeof data.panneaux; titre: string; large?: boolean }> = [
		{ clef: 'requetes',     titre: 'Chemins les plus demandes', large: true },
		{ clef: 'hotes',        titre: 'Adresses' },
		{ clef: 'introuvables', titre: 'Introuvables (404)', large: true },
		{ clef: 'statuts',      titre: 'Codes de statut' },
		{ clef: 'navigateurs',  titre: 'Navigateurs' },
		{ clef: 'systemes',     titre: 'Systemes' },
		{ clef: 'heures',       titre: 'Repartition horaire' },
	]

	function fmt(n: number): string {
		return n.toLocaleString('fr-FR')
	}
</script>

<svelte:head><title>Trafic web · Olympus</title></svelte:head>

<div class="entete">
	<h1>Trafic web</h1>
	{#if data.genereIlYA !== null}
		<span class="fraicheur">
			genere il y a {data.genereIlYA}s · regeneration chaque minute
		</span>
	{/if}
</div>

{#if data.indisponible || !data.general}
	<p class="vide">
		Rapport pas encore genere. Le minuteur <code>nodyx-goaccess.timer</code> tourne
		chaque minute ; il faut au moins une requete journalisee.
	</p>
{:else}
	<div class="chiffres">
		<div class="chiffre"><b>{fmt(data.general.requetes)}</b><span>requetes</span></div>
		<div class="chiffre"><b>{fmt(data.general.visiteurs)}</b><span>visiteurs uniques</span></div>
		<div class="chiffre"><b>{fmt(data.general.introuvables)}</b><span>introuvables</span></div>
		<div class="chiffre"><b>{fmt(data.general.fichiers)}</b><span>chemins distincts</span></div>
		<div class="chiffre"><b>{fmt(data.general.echecs)}</b><span>requetes en echec</span></div>
	</div>

	<div class="grille">
		{#each PANNEAUX as p}
			{@const lignes = data.panneaux[p.clef]}
			{#if lignes?.length}
				<section class="panneau" class:large={p.large}>
					<h2>{p.titre}</h2>
					<table>
						<tbody>
							{#each lignes as l}
								<tr>
									<td class="nom" title={l.nom}>{l.nom}</td>
									<td class="nombre">{fmt(l.coups)}</td>
									<td class="barre">
										<!-- La largeur vient d'un pourcentage calcule cote serveur :
										     pas de script, donc rien que la CSP puisse bloquer. -->
										<span style="width:{Math.min(100, l.pourcent)}%"></span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.entete { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
	h1 { margin: 0; font-size: 1.5rem; }
	.fraicheur { font-size: 0.75rem; color: #64748b; font-family: monospace; }
	.vide { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }

	.chiffres { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
	.chiffre { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.6rem; padding: 0.9rem 1rem; }
	.chiffre b { display: block; font-size: 1.4rem; font-variant-numeric: tabular-nums; }
	.chiffre span { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

	.grille { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
	.panneau { background: #0f172a; border: 1px solid #1e293b; border-radius: 0.6rem; padding: 1rem; min-width: 0; }
	.panneau.large { grid-column: 1 / -1; }
	h2 { margin: 0 0 0.75rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; }

	table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
	td { padding: 0.3rem 0.4rem; border-bottom: 1px solid #1e293b40; }
	.nom { max-width: 0; width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; }
	.nombre { text-align: right; font-variant-numeric: tabular-nums; color: #94a3b8; width: 4rem; }
	.barre { width: 30%; }
	.barre span { display: block; height: 5px; border-radius: 3px; background: #6366f1; min-width: 2px; }
</style>
