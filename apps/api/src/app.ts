import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { env } from './config/env'
import { requestLogger } from './middleware/request-logger'
import { notFound } from './middleware/not-found'
import { errorHandler } from './middleware/error-handler'
import { healthRouter } from './routes/health.routes'

export const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN }))
app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)

app.use('/health', healthRouter)

app.use(notFound)
app.use(errorHandler)
