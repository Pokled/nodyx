-- Migration 027: Performance indexes
-- reply_to_id on channel_messages — used in LEFT JOIN when loading history
-- pinned_message_id lookup on channels — used at channel join

CREATE INDEX IF NOT EXISTS idx_channel_messages_reply_to
  ON channel_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channels_pinned_message
  ON channels (pinned_message_id)
  WHERE pinned_message_id IS NOT NULL;
