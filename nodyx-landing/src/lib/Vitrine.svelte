<!--
  start.nodyx.org, refait le 13/10/2026 pour les meneurs de communauté
  (guildes, associations, créateurs, clubs). Anglais et français, rendu côté
  serveur, et rien de simulé : vraies captures de nodyx.org, vraie photo sous
  licence libre, vraies communautés de l'annuaire, vraie progression des
  traductions, vraie version.
-->
<script lang="ts">
  import { CONTENU, type Lang } from '$lib/contenu'
  import type { Donnees } from '$lib/donnees.server'

  const { lang, donnees }: { lang: Lang; donnees: Donnees } = $props()
  const t = $derived(CONTENU[lang])
  const ici = $derived(lang === 'en' ? 'https://start.nodyx.org/' : 'https://start.nodyx.org/fr')
  const autreLien = $derived(lang === 'en' ? '/fr' : '/')

  const COMMANDE = 'curl -fsSL https://nodyx.org/install.sh | bash'
  let copie = $state(false)
  function copier() {
    navigator.clipboard.writeText(COMMANDE)
    copie = true
    setTimeout(() => (copie = false), 2000)
  }

  const NOMS_LANGUE: Record<string, { en: string; fr: string }> = {
    fr: { en: 'French', fr: 'français' }, en: { en: 'English', fr: 'anglais' },
    es: { en: 'Spanish', fr: 'espagnol' }, de: { en: 'German', fr: 'allemand' },
  }
  function langueDe(code: string): string {
    return NOMS_LANGUE[code]?.[lang] ?? code.toUpperCase()
  }

  const jsonLd = $derived(JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Nodyx',
      description: t.meta.description,
      url: ici,
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Linux (Ubuntu, Debian)',
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      ...(donnees.version ? { softwareVersion: donnees.version.replace(/^v/, '') } : {}),
      image: 'https://start.nodyx.org/og.png',
      screenshot: 'https://start.nodyx.org/vitrine/home.webp',
      sameAs: ['https://github.com/Pokled/nodyx', 'https://nodyx.dev', 'https://nodyx.org'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: lang,
      mainEntity: t.faq.liste.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.r },
      })),
    },
  ]).replace(/</g, '\\u003c'))
</script>

<svelte:head>
  <title>{t.meta.titre}</title>
  <meta name="description" content={t.meta.description} />
  <link rel="canonical" href={ici} />
  <link rel="alternate" hreflang="en" href="https://start.nodyx.org/" />
  <link rel="alternate" hreflang="fr" href="https://start.nodyx.org/fr" />
  <link rel="alternate" hreflang="x-default" href="https://start.nodyx.org/" />
  <meta property="og:site_name" content="Nodyx" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={ici} />
  <meta property="og:title" content={t.meta.titre} />
  <meta property="og:description" content={t.meta.description} />
  <meta property="og:locale" content={lang === 'en' ? 'en_US' : 'fr_FR'} />
  <meta property="og:image" content="https://start.nodyx.org/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://start.nodyx.org/og.png" />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<header class="entete">
  <div class="interieur entete-ligne">
    <a class="marque" href={lang === 'en' ? '/' : '/fr'}>
      <img src="/icon-192.png" alt="" width="32" height="32" />
      <span>Nodyx</span>
    </a>
    <nav class="menu" aria-label="Nodyx">
      <a href="#visite">{t.nav.visite}</a>
      <a href="#communautes">{t.nav.communautes}</a>
      <a href="#commencer">{t.nav.commencer}</a>
      <a href="#faq">{t.nav.faq}</a>
      <a href={lang === 'en' ? 'https://nodyx.dev' : 'https://nodyx.dev/fr'}>{t.nav.docs}</a>
    </nav>
    <div class="entete-actions">
      <a class="langue" href={autreLien} hreflang={lang === 'en' ? 'fr' : 'en'}>{t.nav.autre}</a>
      <a class="bouton petit" href="https://nodyx.org">{t.nav.voir}</a>
    </div>
  </div>
</header>

<main>
  <!-- ── Ouverture ─────────────────────────────────────────────────────── -->
  <section class="interieur ouverture">
    <div class="ouverture-texte">
      <h1>{t.ouverture.titre}</h1>
      <p class="chapeau">{t.ouverture.texte}</p>
      <div class="actions">
        <a class="bouton" href="https://nodyx.org">{t.ouverture.voir}</a>
        <a class="bouton secondaire" href="#commencer">{t.ouverture.commencer}</a>
      </div>
      <p class="mention">
        {t.ouverture.libre}, AGPL-3.0{#if donnees.version} · {donnees.version}{/if}
      </p>
    </div>
    <img class="photo" src="/photos/feu-de-camp.jpg" alt={t.ouverture.photo} width="1600" height="900" />
  </section>

  <!-- ── Une journée ───────────────────────────────────────────────────── -->
  <section id="visite" class="interieur journee">
    <h2>{t.journee.titre}</h2>
    <p class="intro">{t.journee.intro}</p>
    <img class="capture-large" src="/vitrine/home.webp" loading="lazy" width="1688" height="1088"
         alt={lang === 'en' ? 'The home page of nodyx.org' : 'La page d\'accueil de nodyx.org'} />
    <div class="moments">
      {#each t.journee.moments as m, i (m.image)}
        <article class="moment" class:inverse={i % 2 === 1}>
          <img src={m.image} alt={m.alt} loading="lazy" width="1688" height="1088" />
          <div>
            <p class="heure">{m.heure}</p>
            <h3>{m.titre}</h3>
            <p>{m.texte}</p>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <!-- ── À votre image ─────────────────────────────────────────────────── -->
  <section class="interieur image">
    <h2>{t.image.titre}</h2>
    <p class="intro">{t.image.texte}</p>
    <div class="duo">
      <figure>
        <img src="/vitrine/appearance.webp" alt={t.image.altAmbiances} loading="lazy" width="1688" height="1088" />
        <figcaption>{t.image.ambiances}</figcaption>
      </figure>
      <figure>
        <img src="/vitrine/homepage-builder.webp" alt={t.image.altAccueil} loading="lazy" width="1688" height="1088" />
        <figcaption>{t.image.accueil}</figcaption>
      </figure>
    </div>
  </section>

  <!-- ── Promesses ─────────────────────────────────────────────────────── -->
  <section class="interieur promesses">
    <h2>{t.promesses.titre}</h2>
    <div class="grille-promesses">
      {#each t.promesses.liste as p (p.titre)}
        <div class="promesse">
          <h3>{p.titre}</h3>
          <p>{p.texte}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- ── Les communautés, en direct ────────────────────────────────────── -->
  <section id="communautes" class="interieur communautes">
    <h2>{t.communautes.titre}</h2>
    <p class="intro">{t.communautes.texte}</p>
    {#if donnees.communautes.length}
      <div class="grille-communautes">
        {#each donnees.communautes as c (c.url)}
          <a class="communaute" href={c.url} rel="noopener">
            <div class="banniere" style:background-image={c.banniere ? `url("${c.banniere}")` : undefined}></div>
            <div class="communaute-corps">
              {#if c.logo}
                <img class="logo" src={c.logo} alt="" width="44" height="44" loading="lazy" />
              {:else}
                <span class="logo initiale" aria-hidden="true">{c.nom.trim().charAt(0).toUpperCase()}</span>
              {/if}
              <h3>{c.nom}</h3>
              {#if c.description}<p>{c.description}</p>{/if}
              <p class="details">
                {t.communautes.membres(c.membres)}{#if c.langue} · {langueDe(c.langue)}{/if}
                <span class="visiter">{t.communautes.visiter}</span>
              </p>
            </div>
          </a>
        {/each}
      </div>
    {:else}
      <p class="intro">{t.communautes.vide}</p>
    {/if}
  </section>

  <!-- ── Les langues, en direct ────────────────────────────────────────── -->
  {#if donnees.langues.length}
    <section class="interieur langues">
      <div class="langues-texte">
        <h2>{t.langues.titre}</h2>
        <p class="intro">{t.langues.texte}</p>
        <a class="bouton secondaire" href="https://nodyx.org/translate">{t.langues.aider}</a>
      </div>
      <ul class="barres">
        {#each donnees.langues as l (l.code)}
          <li>
            <span class="barre-nom">{l.nom}</span>
            <span class="barre"><span style:width="{l.pct}%"></span></span>
            <span class="barre-pct">{l.pct}%</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- ── Commencer ─────────────────────────────────────────────────────── -->
  <section id="commencer" class="interieur commencer">
    <h2>{t.commencer.titre}</h2>
    <ol class="etapes">
      {#each t.commencer.etapes as e, i (e.titre)}
        <li><span class="numero">{i + 1}</span><h3>{e.titre}</h3><p>{e.texte}</p></li>
      {/each}
    </ol>
    <div class="commande">
      <code>{COMMANDE}</code>
      <button type="button" onclick={copier}>{copie ? t.commencer.copie : t.commencer.copier}</button>
    </div>
    <p class="note">{t.commencer.maison}</p>
    <div class="actions">
      <a class="bouton" href={t.commencer.guideUrl}>{t.commencer.guide}</a>
      <a class="bouton secondaire" href="https://nodyx.org">{t.commencer.aide}</a>
    </div>
  </section>

  <!-- ── Questions ─────────────────────────────────────────────────────── -->
  <section id="faq" class="interieur faq">
    <h2>{t.faq.titre}</h2>
    {#each t.faq.liste as f (f.q)}
      <details>
        <summary>{f.q}</summary>
        <p>{f.r}</p>
      </details>
    {/each}
  </section>

  <!-- ── Fin ───────────────────────────────────────────────────────────── -->
  <section class="interieur fin">
    <h2>{t.fin.titre}</h2>
    <div class="actions">
      <a class="bouton" href="#commencer">{t.fin.commencer}</a>
      <a class="bouton secondaire" href="https://nodyx.org">{t.fin.voir}</a>
    </div>
  </section>
</main>

<footer class="pied">
  <div class="interieur pied-ligne">
    <div>
      <p>{t.pied.licence}</p>
      <p class="credit">{t.pied.credit}</p>
    </div>
    <nav aria-label="Liens">
      <a href={lang === 'en' ? 'https://nodyx.dev' : 'https://nodyx.dev/fr'}>{t.pied.docs}</a>
      <a href="https://github.com/Pokled/nodyx">GitHub</a>
      <a href="https://nodyx.org/translate">{t.pied.traduire}</a>
      <a href="https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md">{t.pied.versions}</a>
      <a href="https://nodyx.org">nodyx.org</a>
    </nav>
  </div>
</footer>

<style>
  :global(html) { background: #0b0e16; scroll-behavior: smooth; }
  :global(body) {
    margin: 0;
    background: #0b0e16;
    color: #eef0f7;
    font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :global(*) { box-sizing: border-box; }

  .interieur { width: 100%; max-width: 1140px; margin: 0 auto; padding: 0 24px; }

  h1, h2, h3 { margin: 0; letter-spacing: -0.025em; }
  h2 { font-size: clamp(1.7rem, 3.4vw, 2.5rem); line-height: 1.12; font-weight: 700; }
  h3 { font-size: 1.2rem; line-height: 1.3; font-weight: 650; }
  p { margin: 0; }
  .intro { margin-top: 14px; max-width: 44rem; font-size: 1.08rem; line-height: 1.65; color: #b7bccb; }

  .bouton {
    display: inline-flex; align-items: center; padding: 12px 20px; border-radius: 10px;
    background: #8b8ff7; color: #0b0e16; font-weight: 650; text-decoration: none;
    border: 1px solid #8b8ff7; transition: background 0.15s;
  }
  .bouton:hover { background: #a6a9fb; }
  .bouton.secondaire { background: transparent; color: #eef0f7; border-color: rgba(255,255,255,0.18); }
  .bouton.secondaire:hover { background: rgba(255,255,255,0.06); }
  .bouton.petit { padding: 8px 14px; font-size: 0.9rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }

  /* ── En-tête ── */
  .entete {
    position: sticky; top: 0; z-index: 10;
    background: rgba(11, 14, 22, 0.86); backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .entete-ligne { display: flex; align-items: center; gap: 24px; height: 64px; }
  .marque { display: flex; align-items: center; gap: 10px; color: #eef0f7; text-decoration: none; font-weight: 700; font-size: 1.1rem; }
  .marque img { border-radius: 8px; }
  .menu { display: flex; gap: 22px; margin-left: 12px; }
  .menu a, .langue { color: #b7bccb; text-decoration: none; font-size: 0.95rem; }
  .menu a:hover, .langue:hover { color: #eef0f7; }
  .entete-actions { margin-left: auto; display: flex; align-items: center; gap: 18px; }

  /* ── Ouverture ── */
  .ouverture {
    display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center;
    padding-top: 72px; padding-bottom: 40px;
  }
  h1 { font-size: clamp(2.3rem, 5vw, 3.7rem); line-height: 1.04; font-weight: 800; letter-spacing: -0.04em; }
  .chapeau { margin-top: 22px; font-size: 1.2rem; line-height: 1.6; color: #c9cddb; }
  .mention { margin-top: 18px; font-size: 0.9rem; color: #7e8497; }
  .photo {
    width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: cover; object-position: 35% center;
    border-radius: 18px; border: 1px solid rgba(255,255,255,0.08);
  }

  /* ── Journée ── */
  .journee { padding-top: 96px; }
  .capture-large { display: block; width: 100%; height: auto; margin-top: 36px; }
  .moments { display: flex; flex-direction: column; gap: 72px; margin-top: 72px; }
  .moment { display: grid; grid-template-columns: 1.3fr 1fr; gap: 48px; align-items: center; }
  .moment.inverse { grid-template-columns: 1fr 1.3fr; }
  .moment.inverse img { order: 2; }
  .moment img { width: 100%; height: auto; display: block; }
  .moment p { color: #b7bccb; line-height: 1.7; margin-top: 12px; }
  .heure {
    margin: 0 0 10px !important; font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 0.82rem; letter-spacing: 0.1em; text-transform: uppercase; color: #f2a65a !important;
  }

  /* ── À votre image ── */
  .image { padding-top: 112px; }
  .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 36px; }
  .duo figure { margin: 0; }
  .duo img { width: 100%; height: auto; display: block; }
  .duo figcaption { margin-top: 4px; color: #7e8497; font-size: 0.9rem; text-align: center; }

  /* ── Promesses ── */
  .promesses { padding-top: 112px; }
  .grille-promesses { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 32px; }
  .promesse { padding: 28px; border-radius: 16px; background: #121726; border: 1px solid rgba(255,255,255,0.07); }
  .promesse p { margin-top: 10px; color: #b7bccb; line-height: 1.65; }

  /* ── Communautés ── */
  .communautes { padding-top: 112px; }
  .grille-communautes { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin-top: 32px; }
  .communaute {
    display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;
    background: #121726; border: 1px solid rgba(255,255,255,0.07);
    color: inherit; text-decoration: none; transition: border-color 0.15s, transform 0.15s;
  }
  .communaute:hover { border-color: rgba(139,143,247,0.5); transform: translateY(-2px); }
  .banniere { height: 96px; background: #1a2033 center / cover no-repeat; }
  .communaute-corps { position: relative; padding: 18px 20px 20px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .logo { position: absolute; top: -26px; left: 20px; width: 44px; height: 44px; border-radius: 12px; object-fit: cover; border: 3px solid #121726; background: #121726; }
  .initiale {
    display: flex; align-items: center; justify-content: center;
    background: #262c46; color: #c9cbfb; font-weight: 700; font-size: 1.1rem;
  }
  .communaute h3 { margin-top: 14px; font-size: 1.08rem; }
  .communaute p { color: #b7bccb; font-size: 0.93rem; line-height: 1.55; }
  .details { margin-top: auto !important; padding-top: 8px; display: flex; justify-content: space-between; color: #7e8497 !important; font-size: 0.86rem !important; }
  .visiter { color: #a6a9fb; font-weight: 600; }

  /* ── Langues ── */
  .langues { padding-top: 112px; display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .langues .bouton { margin-top: 24px; }
  .barres { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .barres li { display: grid; grid-template-columns: 9rem 1fr 3.2rem; align-items: center; gap: 14px; font-size: 0.95rem; }
  .barre-nom { color: #d6d9e4; }
  .barre { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .barre span { display: block; height: 100%; border-radius: 99px; background: #8b8ff7; }
  .barre-pct { text-align: right; color: #7e8497; font-variant-numeric: tabular-nums; }

  /* ── Commencer ── */
  .commencer { padding-top: 112px; }
  .etapes { list-style: none; margin: 32px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .etapes li { padding: 24px; border-radius: 16px; background: #121726; border: 1px solid rgba(255,255,255,0.07); }
  .numero {
    display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center;
    border-radius: 99px; background: rgba(242,166,90,0.14); color: #f2a65a; font-weight: 700; margin-bottom: 14px;
  }
  .etapes p { margin-top: 8px; color: #b7bccb; line-height: 1.6; }
  .commande {
    display: flex; align-items: center; gap: 10px; margin-top: 28px; max-width: 40rem;
    padding: 10px 10px 10px 18px; border-radius: 12px; background: #070910; border: 1px solid rgba(255,255,255,0.1);
  }
  .commande code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 0.95rem; color: #d6d9e4; }
  .commande button {
    flex-shrink: 0; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.16);
    background: transparent; color: #eef0f7; cursor: pointer; font: inherit; font-size: 0.88rem;
  }
  .commande button:hover { background: rgba(255,255,255,0.06); }
  .note { margin-top: 18px; max-width: 44rem; color: #b7bccb; line-height: 1.65; }

  /* ── Questions ── */
  .faq { padding-top: 112px; }
  .faq details { max-width: 860px; }
  .faq h2 { margin-bottom: 20px; }
  details { border-bottom: 1px solid rgba(255,255,255,0.08); }
  summary { cursor: pointer; padding: 20px 0; font-size: 1.08rem; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: '+'; color: #8b8ff7; font-size: 1.3rem; line-height: 1; }
  details[open] summary::after { content: '−'; }
  details p { padding: 0 0 20px; color: #b7bccb; line-height: 1.7; max-width: 46rem; }

  /* ── Fin et pied ── */
  .fin { padding-top: 120px; padding-bottom: 120px; text-align: center; }
  .fin h2 { max-width: 20ch; margin: 0 auto; font-size: clamp(1.9rem, 4vw, 3rem); }
  .fin .actions { justify-content: center; }
  .pied { border-top: 1px solid rgba(255,255,255,0.07); }
  .pied-ligne { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 18px; padding-top: 28px; padding-bottom: 28px; font-size: 0.9rem; color: #7e8497; }
  .credit { margin-top: 4px; font-size: 0.82rem; }
  .pied nav { display: flex; flex-wrap: wrap; gap: 18px; }
  .pied a { color: #b7bccb; text-decoration: none; }
  .pied a:hover { color: #eef0f7; }

  /* ── Tablette et téléphone ── */
  @media (max-width: 980px) {
    .menu { display: none; }
    .ouverture, .langues { grid-template-columns: 1fr; gap: 36px; }
    .ouverture { padding-top: 40px; }
    .moment, .moment.inverse { grid-template-columns: 1fr; gap: 20px; }
    .moment.inverse img { order: 0; }
    .etapes { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .interieur { padding: 0 16px; }
    .entete-actions { gap: 12px; }
    .duo, .grille-promesses { grid-template-columns: 1fr; }
    .journee, .image, .promesses, .communautes, .langues, .commencer, .faq { padding-top: 80px; }
    .barres li { grid-template-columns: 6.5rem 1fr 3rem; }
    .fin { padding-top: 88px; padding-bottom: 88px; }
  }
</style>
