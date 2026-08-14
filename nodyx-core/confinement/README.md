# Banc de confinement du bac à sable

Ce dossier ne teste pas notre code. Il teste **la frontière du navigateur**, qui est
la seule chose sur laquelle repose l'isolation des extensions. Aucun test unitaire ne
peut le faire : l'origine opaque, les drapeaux de bac à sable et la politique de
sécurité de contenu n'existent que dans un vrai navigateur.

```bash
npm run test:confinement      # sortie 1 si une seule tentative aboutit
node confinement/run.mjs      # tableau détaillé
node confinement/run.mjs --debug   # journal du navigateur
```

Ce que le banc sert est **réel** : le document de frame vient de
`src/routes/extensionFrame.ts`, le SDK de `sdk/nodyx-sdk.js`. Seule l'extension est une
fixture, et elle est hostile.

Playwright n'est pas une dépendance du dépôt, pour ne pas alourdir l'installation de
tout le monde. Sans lui, le banc s'ignore proprement et sort en 0.

```bash
npm i -D playwright && npx playwright install chromium
```

## Ce qu'il a déjà trouvé

Un blocage total, avant que personne ne le rencontre : une frame en origine opaque
envoie `Origin: null` et récupère les modules en mode CORS. Sans
`Access-Control-Allow-Origin`, le SDK ne se chargeait pas, et
`Cross-Origin-Resource-Policy: same-origin` bloquait la même chose une seconde fois.
Aucune surface n'aurait jamais démarré en production.

## La règle

**Aucune capacité réseau d'extension n'est livrée tant que ce banc n'est pas vert.**
Le proxy est lui-même une capacité de sécurité, il ne se pose pas sur un bac à sable
non prouvé. Voir `SPECS/NODYX_SDK_CDC.md` §14 et `SPECS/NODYX_SDK_SECURITY.md` §9.
