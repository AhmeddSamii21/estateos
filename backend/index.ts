import express from 'express'
import dotenv from 'dotenv'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'

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

import { errorHandler } from './middleware/errorHandler'
import { notFoundHandler } from './middleware/notFound'
import { prisma } from './prisma'
import { startReminderScheduler, stopReminderScheduler } from './services/reminders'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT || 3000)
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: corsOrigin.split(',').map((value) => value.trim()), credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false, limit: '2mb' }))
app.use(compression())

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
const max = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100)
app.use(rateLimit({ windowMs: Number.isFinite(windowMs) ? windowMs : 900000, limit: Number.isFinite(max) ? max : 100, standardHeaders: true, legacyHeaders: false }))

app.get('/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

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
