import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.ts'
import { errorHandler } from './middleware/error-handler.ts'
import { notFound } from './middleware/not-found.ts'
import { requestLogger } from './middleware/request-logger.ts'
import { authRouter } from './routes/auth.routes.ts'
import { activityRouter } from './routes/activity.routes.ts'
import { billingRouter } from './routes/billing.routes.ts'
import { clinicRouter } from './routes/clinic.routes.ts'
import { doctorRouter } from './routes/doctor.routes.ts'
import { holidayRouter } from './routes/holiday.routes.ts'
import { healthRouter } from './routes/health.routes.ts'
import { dutyRouter, scheduleRouter } from './routes/schedule.routes.ts'
import { statsRouter } from './routes/stats.routes.ts'
import { reportsRouter } from './routes/reports.routes.ts'
import { settingsRouter } from './routes/settings.routes.ts'
import { unavailabilityRouter } from './routes/unavailability.routes.ts'
import { usageRouter } from './routes/usage.routes.ts'
import { userRouter } from './routes/user.routes.ts'

export const app = express()

// Deployed behind the nginx reverse proxy; required for req.ip (rate limiting)
// to reflect the real client instead of the proxy address.
app.set('trust proxy', 1)

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)

app.use('/health', healthRouter)
app.use('/auth', authRouter)
app.use('/clinics', clinicRouter)
app.use('/billing', billingRouter)
app.use('/settings', settingsRouter)
app.use('/activity', activityRouter)
app.use('/users', userRouter)
app.use('/doctors', doctorRouter)
app.use('/unavailability', unavailabilityRouter)
app.use('/holidays', holidayRouter)
app.use('/schedules', scheduleRouter)
app.use('/duties', dutyRouter)
app.use('/stats', statsRouter)
app.use('/reports', reportsRouter)
app.use('/usage', usageRouter)

app.use(notFound)
app.use(errorHandler)
