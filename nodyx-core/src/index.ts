import Fastify from 'fastify'
import { Server } from 'socket.io'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import fastifyCors from '@fastify/cors'
import path from 'path'
import { getRandomFortune } from './fortunes'
import { db, redis } from './config/database'
import authRoutes          from './routes/auth'
import adminRoutes         from './routes/admin'
import communityRoutes     from './routes/communities'
import forumRoutes         from './routes/forums'
import instanceRoutes      from './routes/instance'
import userRoutes          from './routes/users'
import searchRoutes        from './routes/search'
import notificationRoutes  from './routes/notifications'
import chatRoutes          from './routes/chat'
import directoryRoutes    from './routes/directory'
import assetRoutes        from './routes/assets'
import gardenRoutes       from './routes/garden'
import whisperRoutes      from './routes/whispers'
import pollRoutes         from './routes/polls'
import dmRoutes           from './routes/dm'
import eventRoutes           from './routes/events'
import authenticatorRoutes   from './routes/authenticator'
import taskRoutes            from './routes/tasks'
import honeypotRoutes        from './routes/honeypot'
import totpRoutes            from './routes/totp'
import wikiRoutes            from './routes/wiki'
import socialRoutes          from './routes/social'
import memberRoutes          from './routes/members'
import { widgetStoreRoutes } from './routes/widgetStore'
import { widgetDemoRoutes }  from './routes/widgetDemo'
import { adminBackupRoutes } from './routes/admin_backups'
import canvasRoutes          from './routes/canvas'
import twitchRoutes           from './routes/twitch'
import { setIO }              from './socket/io'
import { registerSocketIO } from './socket/index'
import { runMigrations }    from './scripts/migrate'
import { startScheduler }  from './scheduler'

const server = Fastify({ logger: true, trustProxy: true })

// ── CORS (pour les appels fetch client-side : upload, chat, mentions) ────────
const corsOrigin = process.env.FRONTEND_URL
  || (process.env.NODE_ENV === 'production' ? false : true)

// Signet PWA origin (signet.nodyx.org ou équivalent auto-hébergé)
const signetOrigin = process.env.SIGNET_URL || null

server.register(fastifyCors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // SSR / curl
    const allowed = [
      typeof corsOrigin === 'string' ? corsOrigin : null,
      signetOrigin,
    ].filter(Boolean) as string[]
    if (typeof corsOrigin === 'boolean' && corsOrigin) return cb(null, true)
    if (allowed.some(o => origin === o)) return cb(null, true)
    cb(new Error('CORS: origin non autorisée'), false)
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
})

// ── Static files (uploads) ───────────────────────────────────
server.register(fastifyStatic, {
  root:       path.join(process.cwd(), 'uploads'),
  prefix:     '/uploads/',
  decorateReply: false,
})

// ── Multipart (file uploads) ─────────────────────────────────
server.register(fastifyMultipart, {
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB max
})

// ── Root & health ────────────────────────────────────────────

server.get('/', async () => {
  return {
    name: 'Nodyx',
    version: process.env.NODYX_VERSION ?? '1.9.0',
    message: getRandomFortune(),
    status: 'alive'
  }
})

server.get('/api/v1/health', async (request, reply) => {
  try {
    await db.query('SELECT 1')
    await redis.ping()
    return reply.send({ status: 'ok', database: 'connected', cache: 'connected' })
  } catch {
    return reply.code(503).send({ status: 'error', database: 'disconnected', cache: 'disconnected' })
  }
})

// ── Blocklist check ──────────────────────────────────────────
// Rejects IPs confirmed malicious by the distributed honeypot network.
// Checked before any route handler — no auth overhead for known bad actors.

server.addHook('onRequest', async (request, reply) => {
  // Skip: honeypot itself + health + directory blocklist feed
  const url = request.url
  if (
    url.startsWith('/api/v1/_hp') ||
    url === '/api/v1/health' ||
    url.startsWith('/api/directory/blocklist')
  ) return

  const ip = request.ip
  if (!ip || ip === '127.0.0.1' || ip === '::1' ||
      ip.startsWith('192.168.') || ip.startsWith('10.') ||
      ip.startsWith('::ffff:127.') || ip.startsWith('172.16.')) return

  try {
    const blocked = await redis.sismember('blocklist', ip)
    if (blocked) {
      return reply.code(403).send({ error: 'Access denied' })
    }
  } catch {
    // Redis unavailable — fail open (never block legit traffic)
  }
})

// ── Routes ───────────────────────────────────────────────────

server.register(authRoutes,      { prefix: '/api/v1/auth' })
server.register(adminRoutes,     { prefix: '/api/v1/admin' })
server.register(communityRoutes, { prefix: '/api/v1/communities' })
server.register(forumRoutes,     { prefix: '/api/v1/forums' })
server.register(instanceRoutes,  { prefix: '/api/v1/instance' })
server.register(userRoutes,      { prefix: '/api/v1/users' })
server.register(searchRoutes,        { prefix: '/api/v1/search' })
server.register(notificationRoutes,  { prefix: '/api/v1/notifications' })
server.register(chatRoutes,          { prefix: '/api/v1/chat' })
server.register(directoryRoutes,     { prefix: '/api' })
server.register(assetRoutes,         { prefix: '/api/v1/assets' })
server.register(gardenRoutes,        { prefix: '/api/v1/garden' })
server.register(whisperRoutes,       { prefix: '/api/v1/whispers' })
server.register(pollRoutes,          { prefix: '/api/v1/polls' })
server.register(dmRoutes,            { prefix: '/api/v1/dm' })
server.register(eventRoutes,          { prefix: '/api/v1/events' })
server.register(authenticatorRoutes,  { prefix: '/api/auth' })
server.register(taskRoutes,           { prefix: '/api/v1/tasks' })
server.register(honeypotRoutes,       { prefix: '/api/v1' })
server.register(totpRoutes,           { prefix: '/api/v1/auth/totp' })
server.register(wikiRoutes,           { prefix: '/api/v1/wiki' })
server.register(socialRoutes,         { prefix: '/api/v1/social' })
server.register(memberRoutes,         { prefix: '/api/v1/members' })
server.register(widgetStoreRoutes,    { prefix: '/api/v1' })
server.register(widgetDemoRoutes,     { prefix: '/api/v1' })
server.register(adminBackupRoutes,    { prefix: '/api/v1' })
server.register(canvasRoutes,         { prefix: '/api/v1/canvas' })
server.register(twitchRoutes,         { prefix: '/api/v1/twitch' })

const start = async () => {
  // Validate critical environment variables at startup.
  const jwtSecret = process.env.JWT_SECRET ?? ''
  if (jwtSecret.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters. Refusing to start.')
    process.exit(1)
  }

  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_PASSWORD) {
    console.warn('[Security] REDIS_PASSWORD not set — Redis est exposé sans authentification. Si Redis écoute sur 0.0.0.0, définissez REDIS_PASSWORD dans .env.')
  }

  await runMigrations()

  try {
    await server.listen({
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || '0.0.0.0'
    })
    console.log('🚀 Nodyx Core démarré sur http://localhost:3000')

    // Attach Socket.IO after listen() — fastify-socket.io is incompatible with Fastify v5
    const io = new Server(server.server, {
      cors: {
        origin: [
          (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
          ...(process.env.SIGNET_URL ? [process.env.SIGNET_URL.replace(/\/$/, '')] : []),
        ],
        credentials: true,
      },
      // Polling en premier : établit la session de manière fiable sur les instances
      // directes ET relay (qui strip le header Upgrade WebSocket).
      // Socket.IO sonde ensuite une upgrade WebSocket : sur les instances directes
      // elle réussit ; sur relay elle échoue gracieusement et reste sur polling.
      transports: ['polling', 'websocket'],
      // Keep ping interval under the relay server's request timeout (~11s).
      // Without this, long-polling connections are held open for 25s and the
      // relay proxy kills them before the server can respond, causing repeated
      // connection failures and blocking browser connection slots.
      pingInterval: 8000,
      pingTimeout:  4000,
    })
    setIO(io)
    registerSocketIO(io)
    console.log('⚡ Socket.IO prêt')
    startScheduler(io)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()