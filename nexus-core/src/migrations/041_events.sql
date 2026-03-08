-- Migration 041 — Calendrier communautaire (events)
-- Chaque instance gère ses propres événements publics/privés.
-- Les événements publics sont annoncés au réseau via le Gossip Protocol.

CREATE TABLE IF NOT EXISTS events (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID          REFERENCES communities(id) ON DELETE CASCADE,
  author_id     UUID          REFERENCES users(id)       ON DELETE SET NULL,
  title         TEXT          NOT NULL,
  description   TEXT          NOT NULL DEFAULT '',
  location      TEXT,                         -- nom du lieu, URL de visio, etc.
  starts_at     TIMESTAMPTZ   NOT NULL,
  ends_at       TIMESTAMPTZ,                  -- NULL = durée inconnue / toute la journée
  is_all_day    BOOLEAN       NOT NULL DEFAULT false,
  is_public     BOOLEAN       NOT NULL DEFAULT true,
  cover_url     TEXT,                         -- image d'en-tête optionnelle
  tags          TEXT[]        NOT NULL DEFAULT '{}',
  is_cancelled  BOOLEAN       NOT NULL DEFAULT false,
  rsvp_enabled  BOOLEAN       NOT NULL DEFAULT false,
  max_attendees INT,                          -- NULL = illimité
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_indexed_at TIMESTAMPTZ               -- propagation réseau
);

-- RSVP des membres
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'going' CHECK (status IN ('going','maybe','not_going')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS events_starts_at    ON events(starts_at);
CREATE INDEX IF NOT EXISTS events_community_id ON events(community_id);
CREATE INDEX IF NOT EXISTS events_is_public    ON events(is_public) WHERE is_public = true;
