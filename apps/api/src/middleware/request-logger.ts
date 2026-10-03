import { pinoHttp } from 'pino-http'
import { logger } from '../logger'

export const requestLogger = pinoHttp({
  logger,
  redact: {
    // The refresh token travels in Set-Cookie on login/refresh; never log it.
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    censor: '[redacted]',
  },
})
