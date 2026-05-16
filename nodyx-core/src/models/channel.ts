import { db } from '../config/database'

export interface Channel {
  id:             string
  community_id:   string
  name:           string
  slug:           string
  description:    string | null
  type:           'text' | 'voice'
  position:       number
  created_at:     string
  name_color:     string | null
  name_bold:      boolean
  name_italic:    boolean
  name_underline: boolean
  icon_emoji:     string | null
}

export interface ChannelStyleUpdate {
  name?:           string
  description?:    string | null
  name_color?:     string | null
  name_bold?:      boolean
  name_italic?:    boolean
  name_underline?: boolean
  icon_emoji?:     string | null
}

export interface ReactionSummary {
  emoji:          string
  count:          number
  userReactedIds: string[]
  usernames:      string[]
}

export interface ChannelMessage {
  id:                  string
  channel_id:          string
  author_id:           string
  content:             string | null
  created_at:          string
  edited_at:           string | null
  is_deleted:          boolean
  author_username:          string
  author_avatar:            string | null
  author_name_color:        string | null
  author_name_glow:         string | null
  author_name_glow_intensity: number | null
  author_name_animation:    string | null
  author_name_font_family:  string | null
  author_name_font_url:     string | null
  reactions?:          ReactionSummary[]
  reply_to_id?:        string | null
  reply_to_username?:  string | null
  reply_to_content?:   string | null
  poll_id?:            string | null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

export async function listByCommunity(communityId: string): Promise<Channel[]> {
  const { rows } = await db.query<Channel>(
    `SELECT * FROM channels WHERE community_id = $1 ORDER BY position ASC, created_at ASC`,
    [communityId]
  )
  return rows
}

export async function findById(id: string): Promise<Channel | null> {
  const { rows } = await db.query<Channel>(
    `SELECT * FROM channels WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function findMessageById(messageId: string): Promise<{ channel_id: string } | null> {
  const { rows } = await db.query<{ channel_id: string }>(
    `SELECT channel_id FROM channel_messages WHERE id = $1`,
    [messageId]
  )
  return rows[0] ?? null
}

export async function create(data: {
  community_id:    string
  name:            string
  description?:    string
  type?:           'text' | 'voice'
  name_color?:     string | null
  name_bold?:      boolean
  name_italic?:    boolean
  name_underline?: boolean
  icon_emoji?:     string | null
}): Promise<Channel> {
  const slug = slugify(data.name)

  const { rows: posRows } = await db.query<{ max: number }>(
    `SELECT COALESCE(MAX(position), -1) AS max FROM channels WHERE community_id = $1`,
    [data.community_id]
  )
  const position = (posRows[0]?.max ?? -1) + 1

  const { rows } = await db.query<Channel>(
    `INSERT INTO channels
       (community_id, name, slug, description, position, type,
        name_color, name_bold, name_italic, name_underline, icon_emoji)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.community_id,
      data.name,
      slug,
      data.description ?? null,
      position,
      data.type ?? 'text',
      data.name_color ?? null,
      data.name_bold ?? false,
      data.name_italic ?? false,
      data.name_underline ?? false,
      data.icon_emoji ?? null,
    ]
  )
  return rows[0]
}

export async function update(id: string, patch: ChannelStyleUpdate): Promise<Channel | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  // Le slug reste stable (= identifiant URL). Seul le name change librement.
  if (patch.name        !== undefined) { fields.push(`name        = $${i++}`); values.push(patch.name) }
  if (patch.description !== undefined) { fields.push(`description = $${i++}`); values.push(patch.description) }
  if (patch.name_color     !== undefined) { fields.push(`name_color     = $${i++}`); values.push(patch.name_color) }
  if (patch.name_bold      !== undefined) { fields.push(`name_bold      = $${i++}`); values.push(patch.name_bold) }
  if (patch.name_italic    !== undefined) { fields.push(`name_italic    = $${i++}`); values.push(patch.name_italic) }
  if (patch.name_underline !== undefined) { fields.push(`name_underline = $${i++}`); values.push(patch.name_underline) }
  if (patch.icon_emoji     !== undefined) { fields.push(`icon_emoji     = $${i++}`); values.push(patch.icon_emoji) }
  if (fields.length === 0) return findById(id)

  values.push(id)
  const { rows } = await db.query<Channel>(
    `UPDATE channels SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  )
  return rows[0] ?? null
}

export async function remove(id: string): Promise<void> {
  await db.query(`DELETE FROM channels WHERE id = $1`, [id])
}

export async function reorder(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::int)`).join(', ')
  const params = ids.flatMap((id, i) => [id, i])
  await db.query(
    `UPDATE channels AS c SET position = v.pos
     FROM (VALUES ${placeholders}) AS v(id, pos)
     WHERE c.id = v.id`,
    params
  )
}

export async function addMessage(data: {
  channel_id:   string
  author_id:    string
  content:      string
  reply_to_id?: string | null
}): Promise<ChannelMessage> {
  const { rows } = await db.query<ChannelMessage>(
    `WITH inserted AS (
       INSERT INTO channel_messages (channel_id, author_id, content, reply_to_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT
       i.*,
       u.username              AS author_username,
       u.avatar                AS author_avatar,
       p.name_color            AS author_name_color,
       p.name_glow             AS author_name_glow,
       p.name_glow_intensity   AS author_name_glow_intensity,
       p.name_animation        AS author_name_animation,
       p.name_font_family      AS author_name_font_family,
       p.name_font_url         AS author_name_font_url,
       rp.id        AS reply_to_id,
       ru.username  AS reply_to_username,
       CASE WHEN rp.is_deleted THEN NULL ELSE rp.content END AS reply_to_content
     FROM inserted i
     JOIN users u ON u.id = i.author_id
     LEFT JOIN user_profiles p ON p.user_id = i.author_id
     LEFT JOIN channel_messages rp ON rp.id = i.reply_to_id
     LEFT JOIN users ru ON ru.id = rp.author_id`,
    [data.channel_id, data.author_id, data.content, data.reply_to_id ?? null]
  )
  return { ...rows[0], reactions: [] }
}

export async function getHistory(
  channelId: string,
  limit = 50,
  before?: string
): Promise<ChannelMessage[]> {
  const params: unknown[] = [channelId, limit]
  let whereExtra = ''
  if (before) {
    params.push(before)
    whereExtra = `AND cm.created_at < $${params.length}`
  }

  const { rows } = await db.query<ChannelMessage>(
    `SELECT
       cm.id,
       cm.channel_id,
       cm.author_id,
       cm.edited_at,
       cm.is_deleted,
       cm.created_at,
       cm.poll_id,
       CASE WHEN cm.is_deleted THEN NULL ELSE cm.content END AS content,
       u.username              AS author_username,
       u.avatar                AS author_avatar,
       p.name_color            AS author_name_color,
       p.name_glow             AS author_name_glow,
       p.name_glow_intensity   AS author_name_glow_intensity,
       p.name_animation        AS author_name_animation,
       p.name_font_family      AS author_name_font_family,
       p.name_font_url         AS author_name_font_url,
       cm.reply_to_id,
       ru.username  AS reply_to_username,
       CASE WHEN rp.is_deleted THEN NULL ELSE rp.content END AS reply_to_content
     FROM channel_messages cm
     JOIN users u ON u.id = cm.author_id
     LEFT JOIN user_profiles p ON p.user_id = cm.author_id
     LEFT JOIN channel_messages rp ON rp.id = cm.reply_to_id
     LEFT JOIN users ru ON ru.id = rp.author_id
     WHERE cm.channel_id = $1 ${whereExtra}
     ORDER BY cm.created_at DESC
     LIMIT $2`,
    params
  )

  const messages = rows.reverse()

  // Bulk-load reactions
  if (messages.length > 0) {
    const ids = messages.map(m => m.id)
    const reactMap = await getReactionsForMessages(ids)
    return messages.map(m => ({ ...m, reactions: reactMap.get(m.id) ?? [] }))
  }

  return messages
}

// ── Reactions ─────────────────────────────────────────────────────────────────

export async function toggleReaction(
  messageId: string,
  userId:    string,
  emoji:     string
): Promise<{ added: boolean; reactions: ReactionSummary[] }> {
  // Try to delete first (toggle off)
  const { rowCount } = await db.query(
    `DELETE FROM channel_message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3`,
    [messageId, userId, emoji]
  )
  const added = (rowCount ?? 0) === 0
  if (added) {
    await db.query(
      `INSERT INTO channel_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [messageId, userId, emoji]
    )
  }

  const reactions = await _loadReactions(messageId)
  return { added, reactions }
}

async function _loadReactions(messageId: string): Promise<ReactionSummary[]> {
  const { rows } = await db.query<{ emoji: string; count: string; user_ids: string[]; usernames: string[] }>(
    `SELECT r.emoji,
            COUNT(*)::text                                       AS count,
            array_agg(r.user_id::text ORDER BY r.created_at)    AS user_ids,
            array_agg(u.username      ORDER BY r.created_at)    AS usernames
     FROM channel_message_reactions r
     JOIN users u ON u.id = r.user_id
     WHERE r.message_id = $1
     GROUP BY r.emoji
     ORDER BY MIN(r.created_at) ASC`,
    [messageId]
  )
  return rows.map(r => ({
    emoji:          r.emoji,
    count:          parseInt(r.count, 10),
    userReactedIds: r.user_ids ?? [],
    usernames:      r.usernames ?? [],
  }))
}

export async function getReactionsForMessages(
  messageIds: string[]
): Promise<Map<string, ReactionSummary[]>> {
  if (messageIds.length === 0) return new Map()

  const { rows } = await db.query<{ message_id: string; emoji: string; count: string; user_ids: string[]; usernames: string[] }>(
    `SELECT r.message_id::text,
            r.emoji,
            COUNT(*)::text                                       AS count,
            array_agg(r.user_id::text ORDER BY r.created_at)    AS user_ids,
            array_agg(u.username      ORDER BY r.created_at)    AS usernames
     FROM channel_message_reactions r
     JOIN users u ON u.id = r.user_id
     WHERE r.message_id = ANY($1::uuid[])
     GROUP BY r.message_id, r.emoji
     ORDER BY r.message_id, MIN(r.created_at) ASC`,
    [messageIds]
  )

  const map = new Map<string, ReactionSummary[]>()
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, [])
    map.get(r.message_id)!.push({
      emoji:          r.emoji,
      count:          parseInt(r.count, 10),
      userReactedIds: r.user_ids ?? [],
      usernames:      r.usernames ?? [],
    })
  }
  return map
}

// ── Edit / Delete ─────────────────────────────────────────────────────────────

export async function editMessage(
  messageId: string,
  userId:    string,
  content:   string
): Promise<ChannelMessage | null> {
  const { rows } = await db.query<ChannelMessage>(
    `UPDATE channel_messages
     SET content = $3, edited_at = NOW()
     WHERE id = $1 AND author_id = $2 AND is_deleted = false
     RETURNING *`,
    [messageId, userId, content]
  )
  return rows[0] ?? null
}

// ── Pinned message ────────────────────────────────────────────────────────────

export async function setPinnedMessage(
  channelId: string,
  messageId: string | null
): Promise<void> {
  await db.query(
    `UPDATE channels SET pinned_message_id = $2 WHERE id = $1`,
    [channelId, messageId]
  )
}

export async function getPinnedMessage(
  channelId: string
): Promise<ChannelMessage | null> {
  const { rows } = await db.query<{ message_id: string }>(
    `SELECT pinned_message_id AS message_id FROM channels WHERE id = $1`,
    [channelId]
  )
  const messageId = rows[0]?.message_id
  if (!messageId) return null

  const { rows: msgRows } = await db.query<ChannelMessage>(
    `SELECT
       cm.id, cm.channel_id, cm.author_id, cm.edited_at, cm.is_deleted, cm.created_at,
       CASE WHEN cm.is_deleted THEN NULL ELSE cm.content END AS content,
       u.username AS author_username, u.avatar AS author_avatar
     FROM channel_messages cm
     JOIN users u ON u.id = cm.author_id
     WHERE cm.id = $1`,
    [messageId]
  )
  return msgRows[0] ?? null
}

export async function deleteMessage(
  messageId: string,
  userId:    string,
  byAdmin = false
): Promise<{ ok: boolean; channelId: string | null }> {
  const { rows } = byAdmin
    ? await db.query<{ channel_id: string }>(
        `UPDATE channel_messages SET is_deleted = true, content = ''
         WHERE id = $1 AND is_deleted = false RETURNING channel_id`,
        [messageId]
      )
    : await db.query<{ channel_id: string }>(
        `UPDATE channel_messages SET is_deleted = true, content = ''
         WHERE id = $1 AND author_id = $2 AND is_deleted = false RETURNING channel_id`,
        [messageId, userId]
      )
  if (rows.length === 0) return { ok: false, channelId: null }
  return { ok: true, channelId: rows[0].channel_id }
}
