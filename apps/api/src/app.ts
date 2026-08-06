import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { notFound } from './middleware/not-found'
import { requestLogger } from './middleware/request-logger'
import { authRouter } from './routes/auth.routes'
import { healthRouter } from './routes/health.routes'
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

app.use(notFound)
app.use(errorHandler)
