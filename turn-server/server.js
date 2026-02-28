/**
 * Nexus TURN Server — node-turn
 * Copy .env.example to .env and fill in your values before starting.
 */
require('dotenv').config()
const TurnServer = require('node-turn')

const EXTERNAL_IP = process.env.TURN_EXTERNAL_IP
const RELAY_IP    = process.env.TURN_RELAY_IP || '0.0.0.0'
const PORT        = parseInt(process.env.TURN_PORT || '3478', 10)
const USER        = process.env.TURN_USERNAME || 'guest'
const PASSWORD    = process.env.TURN_CREDENTIAL || 'changeme'
const REALM       = process.env.TURN_REALM || 'nexus.local'

if (!EXTERNAL_IP) {
  console.error('[turn] ERROR: TURN_EXTERNAL_IP is not set. Please configure your .env file.')
  process.exit(1)
}

const server = new TurnServer({
  authMech: 'none',
  credentials: { [USER]: PASSWORD },
  listeningPort: PORT,
  listeningIps: ['0.0.0.0'],
  relayIps: [RELAY_IP],
  externalIps: EXTERNAL_IP,
  minPort: 49152,
  maxPort: 55440,
  realm: REALM,
  debugLevel: 'ALL',
})

server.start()
console.log(`[turn] Listening UDP ${PORT} | relay=${EXTERNAL_IP} | realm=${REALM}`)
