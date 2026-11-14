-- Lot C2 (SPECS/NODYX_COMMANDES_CDC.md, D56) : les jeux du chat tirés par le serveur.
-- `game` n'est rempli QUE par le cœur (socket chat:command, services/chatGames.ts) :
-- { v, kind, input, result }. Un message qui le porte affiche « Lancé par Nodyx ».
-- NULL pour tous les autres messages, y compris les anciens jeux tirés par le navigateur.
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS game JSONB NULL;
