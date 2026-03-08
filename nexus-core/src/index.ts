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
import eventRoutes        from './routes/events'
import { setIO }           from './socket/io'
import { registerSocketIO } from './socket/index'
import { runMigrations }    from './scripts/migrate'
import { startScheduler }  from './scheduler'

const server = Fastify({ logger: true })

// ── CORS (pour les appels fetch client-side : upload, chat, mentions) ────────
const corsOrigin = process.env.FRONTEND_URL
  || (process.env.NODE_ENV === 'production' ? false : true)

server.register(fastifyCors, {
  origin:      corsOrigin,
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
    name: 'Nexus',
    version: '0.1.0',
    message: getRandomFortune(),
    status: 'alive'
  }
})

server.get('/api/v1/health', async () => {
  try {
    await db.query('SELECT 1')
    await redis.ping()
    return { status: 'ok',    database: 'connected',    cache: 'connected'    }
  } catch {
    return { status: 'error', database: 'disconnected', cache: 'disconnected' }
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
server.register(eventRoutes,         { prefix: '/api/v1/events' })

const start = async () => {
  await runMigrations()

  try {
    await server.listen({
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || '0.0.0.0'
    })
    console.log('🚀 Nexus Core démarré sur http://localhost:3000')

    // Attach Socket.IO after listen() — fastify-socket.io is incompatible with Fastify v5
    const io = new Server(server.server, {
      cors: {
        origin:      (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),
        credentials: true,
      },
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