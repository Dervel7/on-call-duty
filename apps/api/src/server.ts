import { app } from './app.ts'
import { env } from './config/env.ts'
import { pool } from './db/client.ts'
import { logger } from './logger.ts'

// Explicit 0.0.0.0 so container platforms (Render, Docker) can reach the port.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`API listening on http://0.0.0.0:${env.PORT}`)
})

// Node is PID 1 in the container and ignores SIGTERM unless a handler exists.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`)
    server.close(() => void pool.end().finally(() => process.exit(0)))
  })
}
