import express, { type NextFunction, type Request, type Response } from 'express'
import dotenv from 'dotenv'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { randomUUID } from 'node:crypto'

import authRoutes from './routes/auth'
import activityRoutes from './routes/activity'
import userRoutes from './routes/users'
import propertyRoutes from './routes/properties'
import leadRoutes from './routes/leads'
import appointmentRoutes from './routes/appointments'
import dealRoutes from './routes/deals'
import financeRoutes from './routes/finance'
import maintenanceRoutes from './routes/maintenance'
import documentRoutes from './routes/documents'
import reportRoutes from './routes/reports'
import settingRoutes from './routes/settings'
import notificationRoutes from './routes/notifications'
import ownerRoutes from './routes/owners'
import searchRoutes from './routes/search'
import publicRoutes from './routes/public'
import adminRoutes from './routes/admin'
import webhookRoutes from './routes/webhooks'
import hierarchyRoutes from './routes/hierarchy'
import referralRoutes from './routes/referrals'
import contractRoutes from './routes/contracts'
import leaderboardRoutes from './routes/leaderboard'
import importRoutes from './routes/imports'

import { errorHandler } from './middleware/errorHandler'
import { notFoundHandler } from './middleware/notFound'
import { prisma } from './prisma'
import { startReminderScheduler, stopReminderScheduler } from './services/reminders'
import {
  createInMemoryLimiter,
  loginRateLimitKey,
  publicRateLimitKey,
  registerRateLimitKey
} from './utils/inMemoryRateLimit'
import { buildHealthPayload, probeDatabase } from './utils/health'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 3000)
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

app.disable('x-powered-by')

// A request ID is attached before every other middleware so even failures
// during parsing or rate limiting can be correlated in the error log.
app.use((req: Request, res: Response, next: NextFunction) => {
  const supplied = req.header('X-Request-Id')
  const requestId = supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : randomUUID()
  req.requestId = requestId
  res.setHeader('X-Request-Id', requestId)
  next()
})

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}))
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  next()
})
app.use(cors({ origin: corsOrigin.split(',').map((value) => value.trim()), credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false, limit: '2mb' }))
app.use(compression())

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
const max = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100)
app.use(rateLimit({ windowMs: Number.isFinite(windowMs) ? windowMs : 900000, limit: Number.isFinite(max) ? max : 100, standardHeaders: true, legacyHeaders: false }))

function inMemoryRateLimit(limiter: ReturnType<typeof createInMemoryLimiter>, keyOf: (ip: string | undefined) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = limiter.check(keyOf(req.ip))
    res.setHeader('RateLimit-Limit', String(limiter.max))
    res.setHeader('RateLimit-Remaining', String(result.remaining))
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds))
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' })
    }
    next()
  }
}

// Tests exercise many login flows in one process; keep the limiter active but
// give them headroom while preserving the production defaults.
const isTestEnvironment = process.env.NODE_ENV === 'test'
const authLimiter = createInMemoryLimiter({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || (isTestEnvironment ? 10000 : 10))
})
const registerLimiter = createInMemoryLimiter({
  windowMs: Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000),
  max: Number(process.env.REGISTER_RATE_LIMIT_MAX || (isTestEnvironment ? 10000 : 5))
})
const publicLimiter = createInMemoryLimiter({
  windowMs: Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.PUBLIC_RATE_LIMIT_MAX || (isTestEnvironment ? 10000 : 60))
})

app.use('/api/auth/login', inMemoryRateLimit(authLimiter, loginRateLimitKey))
app.use('/api/auth/register', inMemoryRateLimit(registerLimiter, registerRateLimitKey))
app.use('/api/public', inMemoryRateLimit(publicLimiter, publicRateLimitKey))

const startedAt = new Date()

async function healthHandler(_req: Request, res: Response) {
  const probe = await probeDatabase(prisma)
  const payload = buildHealthPayload({ dbOk: probe.ok, startedAt, dbLatencyMs: probe.latencyMs, dbError: probe.error })
  // Keep the original top-level fields for existing uptime monitors while the
  // envelope carries the richer dependency checks.
  res.status(probe.ok ? 200 : 503).json({
    success: probe.ok,
    status: payload.status,
    timestamp: payload.timestamp,
    data: payload
  })
}

app.get('/health', healthHandler)
app.get('/api/health', healthHandler)

app.use('/api/auth', authRoutes)
app.use('/api/activity', activityRoutes)
app.use('/api/users', userRoutes)
app.use('/api/properties', propertyRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/appointments', appointmentRoutes)
app.use('/api/deals', dealRoutes)
app.use('/api/finance', financeRoutes)
app.use('/api/maintenance', maintenanceRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/settings', settingRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/owners', ownerRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/public', publicRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/hierarchy', hierarchyRoutes)
app.use('/api/referrals', referralRoutes)
app.use('/api/contracts', contractRoutes)
app.use('/api/leaderboard', leaderboardRoutes)
app.use('/api/imports', importRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

let server: ReturnType<typeof app.listen> | undefined

export function start(port: number = PORT) {
  server = app.listen(port, () => {
    console.log(`EstateOS API listening on port ${port}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    startReminderScheduler()
  })
  return server
}

export async function shutdown(): Promise<void> {
  stopReminderScheduler()
  await new Promise<void>((resolve) => {
    if (!server) return resolve()
    server.close(() => resolve())
  })
  await prisma.$disconnect()
}

if (require.main === module) {
  start()
  const signalHandler = () => {
    void shutdown().finally(() => process.exit(0))
  }
  process.on('SIGINT', signalHandler)
  process.on('SIGTERM', signalHandler)
}

export default app
