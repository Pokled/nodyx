-- Lien sondages ↔ fils de discussion du forum
ALTER TABLE polls ADD COLUMN thread_id UUID REFERENCES threads(id) ON DELETE CASCADE;
CREATE INDEX idx_polls_thread ON polls (thread_id) WHERE thread_id IS NOT NULL;
