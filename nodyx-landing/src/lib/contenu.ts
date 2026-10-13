// Les textes de start.nodyx.org, en anglais et en français. Chaque langue est
// écrite comme un texte à part entière, pas traduite mot à mot.

export type Lang = 'en' | 'fr'

export const CONTENU = {
  en: {
    meta: {
      titre: 'Nodyx: your community deserves a place of its own',
      description: 'Forum, chat, voice channels, events and your own homepage, on a server that belongs to you. Free and open source, no ads, no algorithm, no tracking.',
    },
    nav: { visite: 'Tour', communautes: 'Communities', commencer: 'Get started', faq: 'FAQ', docs: 'Docs', voir: 'See it live', autre: 'Français' },
    ouverture: {
      titre: 'Your community deserves a place of its own.',
      texte: 'Forum, chat, voice channels, events and your own homepage, on a server that belongs to you. No ads, no algorithm deciding what your members see, and nobody who can shut it down but you.',
      voir: 'Visit a live community',
      commencer: 'Start yours',
      libre: 'Free and open source',
      photo: 'Friends gathered around a campfire at night, one playing the guitar',
    },
    journee: {
      titre: 'A day in your community',
      intro: 'Real screenshots from nodyx.org, the project\'s own community.',
      moments: [
        {
          heure: 'Morning',
          titre: 'The question that gets an answer',
          texte: 'Someone asks how to set up their microphone. By lunchtime three members have answered, and the thread stays there, easy to find, for the next person who has the same question, search engines included.',
          image: '/vitrine/forum.webp',
          alt: 'The forum of a Nodyx community, with categories and the latest messages',
        },
        {
          heure: 'Afternoon',
          titre: 'Friday night gets organised',
          texte: 'An event with a time, a place and sign-ups. A poll to pick the game. Everyone knows when and where, and nobody has to scroll back through a chat to find out.',
          image: '/vitrine/calendar.webp',
          alt: 'The community calendar with upcoming events',
        },
        {
          heure: 'Evening',
          titre: 'Everybody in the voice channel',
          texte: 'Talk, share your screen, launch a game right inside the call. Whoever joins late sees the shared screen straight away.',
          image: '/vitrine/voice-screenshare.webp',
          alt: 'A voice channel with a screen share of Blender on the Nodyx Stage',
        },
        {
          heure: 'Late at night',
          titre: 'Building something together',
          texte: 'A shared whiteboard to map out the next season, the rules or the tournament bracket. Everyone draws at once, and it is all still there tomorrow.',
          image: '/vitrine/canvas.webp',
          alt: 'A collaborative board with frames, sticky notes and connectors',
        },
      ],
    },
    image: {
      titre: 'It looks like you, not like everyone else.',
      texte: 'Pick one of fourteen ambiances or your own colors, compose the homepage by drag and drop, and choose what visitors see first. Your members see nothing until you press Publish.',
      ambiances: 'Ambiances',
      accueil: 'Homepage',
      altAmbiances: 'The appearance settings with ready-made ambiances',
      altAccueil: 'The homepage builder with a live preview',
    },
    promesses: {
      titre: 'Yours, for real',
      liste: [
        { titre: 'No ads, no tracking', texte: 'Nodyx shows no ads and has no analytics. What happens in your community stays on your server.' },
        { titre: 'Private means private', texte: 'Private messages are encrypted in the browser. The server only ever stores what it cannot read.' },
        { titre: 'Nobody can switch it off', texte: 'It runs on your server, as free software (AGPL-3.0). Even if the project stopped tomorrow, your community would keep going.' },
        { titre: 'Found again, years later', texte: 'Public discussions have real addresses that search engines can read. What your members write doesn\'t vanish into a feed.' },
      ],
    },
    communautes: {
      titre: 'They already have their place.',
      texte: 'Communities listed in the public Nodyx directory, right now. Being listed is optional: the installer asks.',
      membres: (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`,
      visiter: 'Visit',
      vide: 'The directory can\'t be reached at the moment.',
    },
    langues: {
      titre: 'In your members\' language',
      texte: 'The interface is translated by the people who use it. Each language is one plain text file, no account and no tool needed.',
      aider: 'Help translate',
    },
    commencer: {
      titre: 'Easier than you think.',
      etapes: [
        { titre: 'A small server', texte: 'A small VPS rented for a few euros a month, or a Raspberry Pi at home.' },
        { titre: 'One command', texte: 'Paste it into the server\'s terminal. The installer takes care of everything else.' },
        { titre: 'A few questions', texte: 'Your community\'s name, your admin account, how people will reach you. Then it builds and starts.' },
      ],
      maison: 'At home, behind your router? Choose the Nodyx relay: you get an address like yourclub.nodyx.org without opening a single port. Large voice rooms still need a server reachable from the internet; making them work from home too is the next big step.',
      guide: 'Read the installation guide',
      guideUrl: 'https://nodyx.dev/install',
      aide: 'Ask for help on nodyx.org',
      copier: 'Copy',
      copie: 'Copied',
    },
    faq: {
      titre: 'Questions people ask',
      liste: [
        { q: 'Is Nodyx free?', r: 'Yes. Nodyx is free and open source software under the AGPL-3.0 license. The only cost is the server, if you rent one.' },
        { q: 'Do I need to be a developer?', r: 'No. If you can copy a command into a terminal, the installer does the rest: it asks a few questions and sets everything up. The installation guide walks you through each step.' },
        { q: 'Can I run it at home?', r: 'Yes, on a Raspberry Pi 4 or 5 or an old laptop. With the Nodyx relay you don\'t need to open any port on your router. Large voice rooms still need a server reachable from the internet for now.' },
        { q: 'How is it different from Discord?', r: 'Discord is great for many groups. Nodyx is for communities that want to own their place: it runs on your server, under your rules, with a forum that search engines can read and no company that owns your members\' accounts.' },
        { q: 'Can other people find my community?', r: 'If you want. At installation you can list your community in the public directory, so it appears on this page and can be searched from other Nodyx communities.' },
        { q: 'Who makes Nodyx?', r: 'One developer in France started it on February 18, 2026. Contributors and translators from several countries have joined since. No company, no investors.' },
      ],
    },
    fin: {
      titre: 'Give your people a place to gather.',
      voir: 'Visit nodyx.org',
      commencer: 'Start yours',
    },
    pied: {
      licence: 'Free and open source, AGPL-3.0. Born February 18, 2026.',
      credit: 'Campfire photo: Vitaly Gariev, Unsplash.',
      docs: 'Documentation',
      traduire: 'Translate',
      versions: 'Changelog',
    },
  },

  fr: {
    meta: {
      titre: 'Nodyx : votre communauté mérite un endroit à elle',
      description: 'Forum, chat, salons vocaux, événements et votre propre page d\'accueil, sur un serveur qui vous appartient. Libre et gratuit, sans publicité, sans algorithme, sans pistage.',
    },
    nav: { visite: 'Visite', communautes: 'Communautés', commencer: 'Commencer', faq: 'Questions', docs: 'Documentation', voir: 'Voir en vrai', autre: 'English' },
    ouverture: {
      titre: 'Votre communauté mérite un endroit à elle.',
      texte: 'Forum, chat, salons vocaux, événements et votre propre page d\'accueil, sur un serveur qui vous appartient. Pas de publicité, pas d\'algorithme qui choisit ce que voient vos membres, et personne d\'autre que vous ne peut le fermer.',
      voir: 'Visiter une vraie communauté',
      commencer: 'Créer la vôtre',
      libre: 'Libre et gratuit',
      photo: 'Des amis réunis autour d\'un feu de camp le soir, l\'un d\'eux joue de la guitare',
    },
    journee: {
      titre: 'Une journée dans votre communauté',
      intro: 'De vraies captures de nodyx.org, la communauté du projet.',
      moments: [
        {
          heure: 'Le matin',
          titre: 'La question qui trouve sa réponse',
          texte: 'Quelqu\'un demande comment régler son micro. À midi, trois membres ont répondu, et le sujet reste là, facile à retrouver, pour le prochain qui se posera la même question, moteurs de recherche compris.',
          image: '/vitrine/forum.webp',
          alt: 'Le forum d\'une communauté Nodyx, avec ses catégories et les derniers messages',
        },
        {
          heure: 'L\'après-midi',
          titre: 'On organise vendredi soir',
          texte: 'Un événement avec une heure, un lieu et des inscriptions. Un sondage pour choisir le jeu. Tout le monde sait quand et où, sans avoir à remonter le fil d\'un chat.',
          image: '/vitrine/calendar.webp',
          alt: 'Le calendrier de la communauté avec les prochains événements',
        },
        {
          heure: 'Le soir',
          titre: 'Tout le monde au vocal',
          texte: 'On parle, on partage son écran, on lance un jeu directement dans l\'appel. Celui qui arrive en retard voit l\'écran partagé tout de suite.',
          image: '/vitrine/voice-screenshare.webp',
          alt: 'Un salon vocal avec un partage d\'écran de Blender sur le Nodyx Stage',
        },
        {
          heure: 'Tard dans la nuit',
          titre: 'On construit ensemble',
          texte: 'Un tableau blanc partagé pour préparer la prochaine saison, le règlement ou l\'arbre du tournoi. Tout le monde dessine en même temps, et tout est encore là le lendemain.',
          image: '/vitrine/canvas.webp',
          alt: 'Un tableau collaboratif avec des cadres, des notes et des connecteurs',
        },
      ],
    },
    image: {
      titre: 'À votre image, pas à celle de tout le monde.',
      texte: 'Choisissez parmi quatorze ambiances ou vos propres couleurs, composez la page d\'accueil par glisser-déposer, et décidez de ce que les visiteurs voient en premier. Vos membres ne voient rien tant que vous n\'avez pas publié.',
      ambiances: 'Ambiances',
      accueil: 'Page d\'accueil',
      altAmbiances: 'Les réglages d\'apparence et leurs ambiances toutes prêtes',
      altAccueil: 'L\'éditeur de page d\'accueil avec son aperçu en direct',
    },
    promesses: {
      titre: 'Vraiment à vous',
      liste: [
        { titre: 'Ni publicité, ni pistage', texte: 'Nodyx n\'affiche aucune publicité et ne mesure rien. Ce qui se passe dans votre communauté reste sur votre serveur.' },
        { titre: 'Privé veut dire privé', texte: 'Les messages privés sont chiffrés dans le navigateur. Le serveur ne garde que ce qu\'il ne peut pas lire.' },
        { titre: 'Personne ne peut l\'éteindre', texte: 'Il tourne sur votre serveur, en logiciel libre (AGPL-3.0). Même si le projet s\'arrêtait demain, votre communauté continuerait.' },
        { titre: 'Retrouvé, des années après', texte: 'Les discussions publiques ont de vraies adresses que les moteurs de recherche savent lire. Ce qu\'écrivent vos membres ne disparaît pas dans un fil.' },
      ],
    },
    communautes: {
      titre: 'Ils ont déjà leur endroit.',
      texte: 'Les communautés inscrites dans l\'annuaire public de Nodyx, en ce moment. L\'inscription est facultative : l\'installeur vous la propose.',
      membres: (n: number) => `${n} ${n === 1 ? 'membre' : 'membres'}`,
      visiter: 'Visiter',
      vide: 'L\'annuaire est injoignable pour le moment.',
    },
    langues: {
      titre: 'Dans la langue de vos membres',
      texte: 'L\'interface est traduite par celles et ceux qui l\'utilisent. Chaque langue tient dans un simple fichier texte, sans compte ni outil à installer.',
      aider: 'Aider à traduire',
    },
    commencer: {
      titre: 'Plus simple que vous ne le pensez.',
      etapes: [
        { titre: 'Un petit serveur', texte: 'Un petit VPS loué quelques euros par mois, ou un Raspberry Pi à la maison.' },
        { titre: 'Une commande', texte: 'À coller dans le terminal du serveur. L\'installeur s\'occupe de tout le reste.' },
        { titre: 'Quelques questions', texte: 'Le nom de votre communauté, votre compte administrateur, comment on vous rejoint. Puis il construit et démarre tout.' },
      ],
      maison: 'Chez vous, derrière votre box ? Choisissez le relais Nodyx : vous obtenez une adresse comme votreclub.nodyx.org sans ouvrir un seul port. Les grands salons vocaux ont encore besoin d\'un serveur joignable depuis Internet ; les faire fonctionner depuis la maison aussi, c\'est la prochaine grande étape.',
      guide: 'Lire le guide d\'installation',
      guideUrl: 'https://nodyx.dev/fr/install',
      aide: 'Demander de l\'aide sur nodyx.org',
      copier: 'Copier',
      copie: 'Copié',
    },
    faq: {
      titre: 'Les questions qu\'on nous pose',
      liste: [
        { q: 'Nodyx est-il gratuit ?', r: 'Oui. Nodyx est un logiciel libre et gratuit, sous licence AGPL-3.0. Le seul coût, c\'est le serveur, si vous en louez un.' },
        { q: 'Faut-il être développeur ?', r: 'Non. Si vous savez coller une commande dans un terminal, l\'installeur fait le reste : il vous pose quelques questions et met tout en place. Le guide d\'installation vous accompagne à chaque étape.' },
        { q: 'Peut-on l\'héberger chez soi ?', r: 'Oui, sur un Raspberry Pi 4 ou 5 ou un vieux portable. Avec le relais Nodyx, vous n\'ouvrez aucun port sur votre box. Les grands salons vocaux ont encore besoin d\'un serveur joignable depuis Internet, pour l\'instant.' },
        { q: 'Quelle différence avec Discord ?', r: 'Discord convient très bien à beaucoup de groupes. Nodyx s\'adresse aux communautés qui veulent posséder leur endroit : il tourne sur votre serveur, avec vos règles, un forum que les moteurs de recherche savent lire, et aucune entreprise propriétaire des comptes de vos membres.' },
        { q: 'D\'autres peuvent-ils trouver ma communauté ?', r: 'Si vous le souhaitez. À l\'installation, vous pouvez inscrire votre communauté dans l\'annuaire public : elle apparaît alors sur cette page et peut être cherchée depuis les autres communautés Nodyx.' },
        { q: 'Qui fait Nodyx ?', r: 'Un développeur, en France, l\'a lancé le 18 février 2026. Des contributeurs et des traducteurs de plusieurs pays l\'ont rejoint depuis. Pas d\'entreprise, pas d\'investisseurs.' },
      ],
    },
    fin: {
      titre: 'Offrez à votre monde un endroit où se retrouver.',
      voir: 'Visiter nodyx.org',
      commencer: 'Créer la vôtre',
    },
    pied: {
      licence: 'Libre et gratuit, AGPL-3.0. Né le 18 février 2026.',
      credit: 'Photo du feu de camp : Vitaly Gariev, Unsplash.',
      docs: 'Documentation',
      traduire: 'Traduire',
      versions: 'Journal des versions',
    },
  },
} as const
