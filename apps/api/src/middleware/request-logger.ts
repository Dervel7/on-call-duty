import { pinoHttp } from 'pino-http'
import { logger } from '../logger'

export const requestLogger = pinoHttp({
  logger,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[redacted]',
  },
})
