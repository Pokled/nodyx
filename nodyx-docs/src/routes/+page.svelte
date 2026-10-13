<script lang="ts">
  // Accueil de nodyx.dev, réécrit le 13/10/2026. L'ancienne page (3 569 lignes)
  // affichait des chiffres figés et faux, des données de démonstration inventées
  // et des captures d'avril. Ici : la même voix que les README, de vraies
  // captures de nodyx.org, et des chiffres lus en direct (+page.server.ts).
  const { data } = $props()

  const INSTALL_CMD = 'curl -fsSL https://nodyx.org/install.sh | bash'
  let copie = $state(false)

  function copier() {
    navigator.clipboard.writeText(INSTALL_CMD)
    copie = true
    setTimeout(() => { copie = false }, 2000)
  }

  const DESCRIPTION = 'Documentation for Nodyx, the self-hosted community platform you actually own: forum, chat, voice, whiteboard and your own homepage in one install, on your own server.'

  const visite = [
    {
      image: '/img/vitrine/forum.webp',
      alt: 'The Nodyx forum: categories, sub-forums, the latest message of each, recent activity',
      titre: 'A forum that lasts, a chat that lives',
      texte: 'Categories and sub-forums with the latest message of each, so you see where the life is. Every thread has a clean public URL and structured data, so what your community writes can be found again. Next to it: real-time chat, end-to-end encrypted private messages.',
      liens: [{ href: '/readme', label: 'Overview' }, { href: '/editor', label: 'The editor' }],
    },
    {
      image: '/img/vitrine/voice-screenshare.webp',
      alt: 'A voice channel with a live screen share of Blender on the Nodyx Stage',
      titre: 'Voice and screen sharing',
      texte: 'Small rooms talk peer to peer. When a room grows or someone shares their screen, it switches to an SFU on your own server: one upload per speaker, whatever the audience. The share opens on the Stage, and anyone joining mid-share sees it right away.',
      liens: [{ href: '/audio', label: 'Audio engine' }, { href: '/relay', label: 'Relay and P2P' }],
    },
    {
      image: '/img/vitrine/canvas.webp',
      alt: 'The whiteboard: a shared board with frames, sticky notes, hexagons and connectors',
      titre: 'Make things together',
      texte: 'A shared whiteboard where everyone draws at once, task boards to plan a release or a tournament, events with a place and sign-ups, polls with live results. All of it saved on your server.',
      liens: [{ href: '/roadmap', label: 'What is shipped' }],
    },
    {
      image: '/img/vitrine/homepage-builder.webp',
      alt: 'The Homepage Builder: the page structure on the left, a live preview on the right',
      titre: 'Your front door, your way',
      texte: 'Compose the homepage on a 12-column grid with a live preview on desktop, tablet and mobile. Pick one of fourteen ambiances or your own colors, with contrast checked for you. Missing something? Build a widget in plain JavaScript and install it in one click.',
      liens: [{ href: '/homepage-builder', label: 'Homepage Builder' }, { href: '/create-widget', label: 'Create a widget' }],
    },
  ]

  const aiguillage = [
    {
      titre: 'Host a community',
      texte: 'From a fresh server to your first members.',
      liens: [
        { href: '/install', label: 'Installation' },
        { href: '/install-tunnel', label: 'Install behind a tunnel' },
        { href: '/domain', label: 'Domain and HTTPS' },
        { href: '/relay', label: 'Home server, no open port' },
        { href: '/email', label: 'Email' },
      ],
    },
    {
      titre: 'Build on Nodyx',
      texte: 'Widgets, games and how the pieces fit.',
      liens: [
        { href: '/create-widget', label: 'Create a widget' },
        { href: '/homepage-builder', label: 'Homepage Builder' },
        { href: '/module-system', label: 'Module system' },
        { href: '/architecture', label: 'Architecture' },
      ],
    },
    {
      titre: 'Join the project',
      texte: 'Code, words, or a language you speak.',
      liens: [
        { href: '/contributing', label: 'Contributing' },
        { href: 'https://nodyx.org/translate', label: 'Translate Nodyx', externe: true },
        { href: '/roadmap', label: 'Roadmap' },
        { href: '/manifesto', label: 'Manifesto' },
      ],
    },
  ]
</script>

<svelte:head>
  <title>Nodyx Docs, the self-hosted community platform you actually own</title>
  <meta name="description" content={DESCRIPTION} />
  <link rel="canonical" href="https://nodyx.dev" />

  <meta property="og:type"         content="website" />
  <meta property="og:title"        content="Nodyx Docs, the self-hosted community platform you actually own" />
  <meta property="og:description"  content={DESCRIPTION} />
  <meta property="og:url"          content="https://nodyx.dev" />
  <meta property="og:image"        content="https://nodyx.dev/og-default.png" />
  <meta property="og:image:width"  content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="Nodyx Docs, the self-hosted community platform you actually own" />
  <meta name="twitter:description" content={DESCRIPTION} />
  <meta name="twitter:image"       content="https://nodyx.dev/og-default.png" />

  <!-- Pas de SearchAction : l'ancienne page en déclarait une vers /search, qui
       n'existe pas (404). La recherche du site passe par l'en-tête. -->
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Nodyx Docs',
    url: 'https://nodyx.dev',
    description: DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@type': 'Organization', name: 'Nodyx', url: 'https://nodyx.org' },
  })}</script>`}
</svelte:head>

<div class="accueil">
  <section class="ouverture">
    <p class="surtitre">Nodyx documentation</p>
    <h1>The self-hosted community platform you actually own.</h1>
    <p class="chapeau">
      Forum, chat, voice, whiteboard and your own homepage, in one install on a server you control,
      from a small VPS to a Raspberry Pi behind your home router.
    </p>

    <div class="commande">
      <code>{INSTALL_CMD}</code>
      <button type="button" onclick={copier} aria-label="Copy the install command">
        {copie ? 'Copied' : 'Copy'}
      </button>
    </div>

    <div class="actions">
      <a class="bouton principal" href="/install">Installation guide</a>
      <a class="bouton" href="/readme">Read the docs</a>
      <a class="bouton" href="https://nodyx.org" target="_blank" rel="noopener noreferrer">See it live</a>
    </div>

    <img class="capture-ouverture" src="/img/vitrine/home.webp"
         alt="The home page of nodyx.org, a community running Nodyx: featured articles and the latest discussions"
         width="1688" height="1088" />
    <p class="legende">nodyx.org, the project's own community, running the same Nodyx you install.</p>
  </section>

  {#if data.version || data.instances || data.traduction}
    <ul class="chiffres" aria-label="Nodyx today">
      {#if data.version}
        <li><a href="https://github.com/Pokled/nodyx/releases/latest" target="_blank" rel="noopener noreferrer">
          <strong>{data.version}</strong><span>latest release</span></a></li>
      {/if}
      {#if data.instances}
        <li><a href="https://nodyx.org/discover" target="_blank" rel="noopener noreferrer">
          <strong>{data.instances}</strong><span>{data.instances === 1 ? 'community' : 'communities'} in the public directory</span></a></li>
      {/if}
      {#if data.traduction}
        <li><a href="https://nodyx.org/translate" target="_blank" rel="noopener noreferrer">
          <strong>{data.traduction.langues}</strong><span>interface languages, translated by the community</span></a></li>
      {/if}
      <li><a href="https://www.gnu.org/licenses/agpl-3.0" target="_blank" rel="noopener noreferrer">
        <strong>AGPL-3.0</strong><span>free software, for good</span></a></li>
    </ul>
  {/if}

  <section class="visite" aria-label="A tour of Nodyx">
    {#each visite as bloc, i (bloc.image)}
      <article class="bloc" class:inverse={i % 2 === 1}>
        <img src={bloc.image} alt={bloc.alt} width="1688" height="1088" loading="lazy" />
        <div class="bloc-texte">
          <h2>{bloc.titre}</h2>
          <p>{bloc.texte}</p>
          <p class="liens">
            {#each bloc.liens as lien (lien.href)}<a href={lien.href}>{lien.label}</a>{/each}
          </p>
        </div>
      </article>
    {/each}
  </section>

  <section class="partout">
    <h2>Wherever you run it</h2>
    <p>
      The installer asks one question: how will people reach your community? The Nodyx relay,
      written in Rust, gives a home server a public address with outbound connections only:
      website, chat and small-group voice work from behind a router. Large voice rooms still need
      a reachable server today; making them work from home too is the next big piece of work.
    </p>
    <div class="modes">
      <div><strong>Nodyx Relay</strong><span>Nothing to open. <code>yourclub.nodyx.org</code>, even behind a home router.</span></div>
      <div><strong>Your own domain</strong><span>Ports 80 and 443, HTTPS from Let's Encrypt, full control.</span></div>
      <div><strong>A tunnel</strong><span>Cloudflare Tunnel, Pangolin, or your own reverse proxy.</span></div>
    </div>
    <p class="liens">
      <a href="/install">Installation</a><a href="/install-tunnel">Behind a tunnel</a><a href="/relay">How the relay works</a>
    </p>
  </section>

  <section class="aiguillage" aria-label="Where to go next">
    {#each aiguillage as carte (carte.titre)}
      <div class="carte">
        <h2>{carte.titre}</h2>
        <p>{carte.texte}</p>
        <ul>
          {#each carte.liens as lien (lien.href)}
            <li>
              {#if lien.externe}
                <a href={lien.href} target="_blank" rel="noopener noreferrer">{lien.label}</a>
              {:else}
                <a href={lien.href}>{lien.label}</a>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </section>

  <section class="fin">
    <p>
      Nodyx isn't the only open alternative, and it doesn't need to be. If another tool fits your
      community better, use it: <a href="/why-nodyx">Why Nodyx, and the alternatives we respect</a>.
    </p>
  </section>
</div>

<footer class="pied">
  <div class="pied-interieur">
    <span>AGPL-3.0. Born February 18, 2026. <em>"Fork us if we betray you."</em></span>
    <nav aria-label="Project links">
      <a href="https://github.com/Pokled/nodyx" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a href="https://github.com/Pokled/nodyx/releases" target="_blank" rel="noopener noreferrer">Releases</a>
      <a href="https://github.com/Pokled/nodyx/issues" target="_blank" rel="noopener noreferrer">Issues</a>
      <a href="https://nodyx.org" target="_blank" rel="noopener noreferrer">nodyx.org</a>
      <a href="https://start.nodyx.org" target="_blank" rel="noopener noreferrer">start.nodyx.org</a>
    </nav>
  </div>
</footer>

<style>
  .accueil {
    /* Élément flexible du gabarit : sans min-width: 0, il ne rétrécit jamais
       sous la largeur de la commande d'installation (qui ne passe pas à la
       ligne) et la page débordait sur téléphone. */
    min-width: 0;
    width: 100%;
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 24px;
    box-sizing: border-box;
  }

  /* ── Ouverture ───────────────────────────────────────────────────────── */
  .ouverture { padding: 72px 0 24px; text-align: center; }
  .surtitre {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 18px;
  }
  h1 {
    font-size: clamp(2.1rem, 5vw, 3.6rem);
    line-height: 1.06;
    letter-spacing: -0.035em;
    font-weight: 800;
    max-width: 15ch;
    margin: 0 auto;
    color: var(--text);
  }
  .chapeau {
    max-width: 38rem;
    margin: 22px auto 0;
    font-size: 1.15rem;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .commande {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 34rem;
    margin: 32px auto 0;
    padding: 8px 8px 8px 16px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--code-bg);
  }
  .commande code {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--code-text);
  }
  .commande button {
    flex-shrink: 0;
    padding: 6px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .commande button:hover { background: var(--bg-hover); }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 22px;
  }
  .bouton {
    padding: 10px 18px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .bouton:hover { background: var(--bg-hover); }
  .bouton.principal { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bouton.principal:hover { background: var(--accent-hover); }

  .capture-ouverture {
    display: block;
    width: 100%;
    height: auto;
    margin: 56px auto 0;
  }
  .legende { margin: 4px 0 0; font-size: 0.85rem; color: var(--text-muted); }

  /* ── Chiffres en direct ──────────────────────────────────────────────── */
  .chiffres {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1px;
    margin: 48px 0 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--border);
  }
  .chiffres li { background: var(--bg); }
  .chiffres a {
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100%;
    padding: 18px 20px;
    text-decoration: none;
  }
  .chiffres a:hover { background: var(--bg-hover); }
  .chiffres strong { font-size: 1.35rem; color: var(--text); letter-spacing: -0.02em; }
  .chiffres span { font-size: 0.88rem; color: var(--text-muted); }

  /* ── Visite ──────────────────────────────────────────────────────────── */
  .visite { margin-top: 96px; display: flex; flex-direction: column; gap: 88px; }
  .bloc {
    display: grid;
    grid-template-columns: 1.35fr 1fr;
    gap: 48px;
    align-items: center;
  }
  .bloc.inverse { grid-template-columns: 1fr 1.35fr; }
  .bloc.inverse img { order: 2; }
  .bloc img { width: 100%; height: auto; display: block; }
  h2 {
    font-size: 1.6rem;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin: 0 0 14px;
    color: var(--text);
  }
  .bloc-texte p, .partout p, .fin p {
    color: var(--text-secondary);
    line-height: 1.7;
    margin: 0;
  }
  .liens { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 18px !important; }
  .liens a, .fin a, .carte a { color: var(--accent); text-decoration: none; font-weight: 500; }
  .liens a:hover, .fin a:hover, .carte a:hover { text-decoration: underline; }

  /* ── Partout ─────────────────────────────────────────────────────────── */
  .partout {
    margin-top: 104px;
    padding: 40px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg-subtle);
  }
  .partout > p { max-width: 46rem; }
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 28px;
  }
  .modes div {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
  }
  .modes strong { color: var(--text); }
  .modes span { color: var(--text-secondary); font-size: 0.92rem; line-height: 1.55; }
  .modes code { font-family: var(--font-mono); font-size: 0.85em; }

  /* ── Aiguillage ──────────────────────────────────────────────────────── */
  .aiguillage {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-top: 72px;
  }
  .carte { padding: 24px; border: 1px solid var(--border); border-radius: 12px; }
  .carte h2 { font-size: 1.15rem; margin-bottom: 6px; }
  .carte p { margin: 0 0 14px; color: var(--text-muted); font-size: 0.92rem; }
  .carte ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }

  /* ── Fin et pied ─────────────────────────────────────────────────────── */
  .fin { margin: 72px auto 0; max-width: 44rem; text-align: center; padding-bottom: 72px; }
  .pied { border-top: 1px solid var(--border); }
  .pied-interieur {
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 14px;
    font-size: 0.88rem;
    color: var(--text-muted);
  }
  .pied nav { display: flex; flex-wrap: wrap; gap: 18px; }
  .pied a { color: var(--text-secondary); text-decoration: none; }
  .pied a:hover { color: var(--text); }

  /* ── Téléphone et tablette ───────────────────────────────────────────── */
  @media (max-width: 860px) {
    .accueil { padding: 0 16px; }
    .ouverture { padding-top: 48px; }
    .capture-ouverture { margin-top: 36px; }
    .visite { margin-top: 64px; gap: 56px; }
    .bloc, .bloc.inverse { grid-template-columns: 1fr; gap: 20px; }
    .bloc.inverse img { order: 0; }
    .partout { margin-top: 64px; padding: 24px 18px; }
    .modes, .aiguillage { grid-template-columns: 1fr; }
    .pied-interieur { padding: 20px 16px; }
  }
</style>
