import { app } from './app'
import { env } from './config/env'
import { logger } from './logger'

// Explicit 0.0.0.0 so container platforms (Render, Docker) can reach the port.
app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`API listening on http://0.0.0.0:${env.PORT}`)
})
