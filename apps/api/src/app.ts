import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { notFound } from './middleware/not-found'
import { requestLogger } from './middleware/request-logger'
import { authRouter } from './routes/auth.routes'
import { doctorRouter } from './routes/doctor.routes'
import { healthRouter } from './routes/health.routes'
import { holidayRouter } from './routes/holiday.routes'
import { dutyRouter, scheduleRouter } from './routes/schedule.routes'
import { statsRouter } from './routes/stats.routes'
import { reportsRouter } from './routes/reports.routes'
import { unavailabilityRouter } from './routes/unavailability.routes'
import { userRouter } from './routes/user.routes'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)

app.use('/health', healthRouter)
app.use('/auth', authRouter)
app.use('/users', userRouter)
app.use('/doctors', doctorRouter)
app.use('/unavailability', unavailabilityRouter)
app.use('/holidays', holidayRouter)
app.use('/schedules', scheduleRouter)
app.use('/duties', dutyRouter)
app.use('/stats', statsRouter)
app.use('/reports', reportsRouter)

app.use(notFound)
app.use(errorHandler)
