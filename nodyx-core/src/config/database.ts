import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import Redis from 'ioredis'

dotenv.config()

export const db = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:                    20,    // default 10 — raised for parallel admin + layout queries
  idleTimeoutMillis:   30000,
  connectionTimeoutMillis: 5000, // fail fast instead of blocking indefinitely
})

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: 'nodyx:',
})
