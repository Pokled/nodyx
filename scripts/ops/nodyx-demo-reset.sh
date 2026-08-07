#!/usr/bin/env bash
# Reset quotidien de l'instance demo.nodyx.org
set -euo pipefail
# Hash bcrypt du mot de passe des comptes de DÉMONSTRATION. Ce n'est pas un
# secret : le mot de passe en clair est déjà public dans `nodyx-core/src/
# scripts/seed.ts`, et ces comptes n'existent que sur demo.nodyx.org, une
# instance remise à zéro tous les jours.
HASH='$2b$10$2q70jhn9/.7oJJIgdVL3nOPAZD8QKzGgFE/mNX1R/BjNafEALz6ky'

sudo -u postgres psql -d demo <<SQL
-- Vider le contenu variable (messages, posts, DMs, notifs, réactions)
TRUNCATE channel_messages, posts, dm_conversations, dm_messages, dm_participants,
         notifications, channel_message_reactions, post_reactions, post_thanks,
         polls, poll_options, poll_votes RESTART IDENTITY CASCADE;

-- Remettre à zéro les threads et les canaux (recréés proprement ensuite)
DELETE FROM threads;
DELETE FROM channels;

-- Recréer les 3 canaux texte + 3 canaux vocaux
INSERT INTO channels (community_id, name, slug, type, position)
SELECT c.id, v.name, v.slug, v.type, v.pos
FROM communities c, (VALUES
  ('général',      'general',      'text',  0),
  ('random',       'random',       'text',  1),
  ('présentation', 'presentation', 'text',  2),
  ('lounge',       'lounge',       'voice', 3),
  ('gaming',       'gaming',       'voice', 4),
  ('music',        'music',        'voice', 5)
) AS v(name, slug, type, pos)
WHERE c.slug = 'demo';

-- Recréer les utilisateurs demo (garder seulement admin, alice, bob, charlie)
DELETE FROM users WHERE username NOT IN ('admin','alice','bob','charlie');
UPDATE users SET email_verified = true,
                 bio = NULL, avatar = NULL, points = 0;

-- Recréer les messages seed
INSERT INTO channel_messages (channel_id, author_id, content) VALUES
  ((SELECT id FROM channels WHERE slug='general'   LIMIT 1), (SELECT id FROM users WHERE username='admin'),   'Bienvenue sur l''instance de démonstration Nodyx ! Connecte-toi avec alice, bob ou charlie — mot de passe : demo1234'),
  ((SELECT id FROM channels WHERE slug='general'   LIMIT 1), (SELECT id FROM users WHERE username='alice'),   'Salut ! Je découvre Nodyx pour la première fois, c''est vraiment propre.'),
  ((SELECT id FROM channels WHERE slug='general'   LIMIT 1), (SELECT id FROM users WHERE username='bob'),     'N''hésitez pas à tester le chat, les canaux vocaux et le forum !'),
  ((SELECT id FROM channels WHERE slug='random'    LIMIT 1), (SELECT id FROM users WHERE username='charlie'), 'Quelqu''un a essayé les réactions sur les messages ?'),
  ((SELECT id FROM channels WHERE slug='random'    LIMIT 1), (SELECT id FROM users WHERE username='alice'),   'Oui ! Et le canal vocal "lounge" est dispo pour tester l''audio 🎙️'),
  ((SELECT id FROM channels WHERE slug='presentation' LIMIT 1), (SELECT id FROM users WHERE username='bob'), 'Admin sys dans une asso, je cherche un outil self-hosted open-source pour notre équipe.');

-- Recréer les threads forum seed
INSERT INTO threads (category_id, author_id, title, slug)
SELECT c.id, (SELECT id FROM users WHERE username='admin'),
       'Bienvenue sur la démo Nodyx !', 'bienvenue-sur-la-demo-nodyx'
FROM categories c LIMIT 1;

INSERT INTO threads (category_id, author_id, title, slug)
SELECT c.id, (SELECT id FROM users WHERE username='alice'),
       'Comparatif Nodyx vs Discord — mes premières impressions', 'comparatif-nodyx-vs-discord'
FROM categories c LIMIT 1;

INSERT INTO posts (thread_id, author_id, content)
SELECT t.id, (SELECT id FROM users WHERE username='admin'),
  'Cette instance est là pour explorer Nodyx librement. Mot de passe : demo1234. Réinitialisée chaque nuit à minuit.'
FROM threads t WHERE slug='bienvenue-sur-la-demo-nodyx';

INSERT INTO posts (thread_id, author_id, content)
SELECT t.id, (SELECT id FROM users WHERE username='alice'),
  'Interface propre, très proche de Discord. Forum intégré = grosse différence. Installation en une commande, impressionnant.'
FROM threads t WHERE slug='comparatif-nodyx-vs-discord';
SQL

runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart demo-core
echo "[$(date)] Demo reset OK"
