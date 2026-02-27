import Fastify, { FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'

/**
 * Creates a minimal Fastify instance for testing.
 * The caller registers only the routes needed for the test.
 */
export async function buildApp(
  registerRoutes: (app: FastifyInstance) => Promise<void>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  await app.register(fastifyCors, { origin: true })
  await registerRoutes(app)
  await app.ready()

  return app
}
