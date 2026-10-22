import { pinoHttp } from 'pino-http'
import { logger } from '../logger.ts'

export const requestLogger = pinoHttp({
  logger,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[redacted]',
  },
})
