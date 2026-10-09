// Global test environment variables
process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-x'
process.env.NODE_ENV   = 'test'

// Isolement des services (09/10/2026) : la suite ne doit JAMAIS joindre le vrai
// Redis ni la vraie base, même lancée dans le dossier de production (où dotenv
// lirait le .env de prod : il n'écrase pas une variable déjà définie). Le port 1
// est fermé : connexion refusée tout de suite. Avant, 3 fichiers de test
// ouvraient une connexion au Redis de prod (poignée de main + INFO, rien d'écrit).
process.env.REDIS_HOST     = '127.0.0.1'
process.env.REDIS_PORT     = '1'
process.env.REDIS_PASSWORD = ''
process.env.DB_HOST        = '127.0.0.1'
process.env.DB_PORT        = '1'
process.env.DB_PASSWORD    = ''
