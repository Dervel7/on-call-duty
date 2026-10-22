import { app } from './app.ts'
import { env } from './config/env.ts'
import { logger } from './logger.ts'

// Explicit 0.0.0.0 so container platforms (Render, Docker) can reach the port.
app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`API listening on http://0.0.0.0:${env.PORT}`)
})
