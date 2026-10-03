import express from 'express'
import request from 'supertest'
import { vi } from 'vitest'

const { lines } = vi.hoisted(() => ({ lines: [] as string[] }))

// vi.mock factories are hoisted above static imports, so pino is loaded here.
vi.mock('../logger', async () => {
  const { pino } = await import('pino')
  return { logger: pino({ level: 'info' }, { write: (line: string) => lines.push(line) }) }
})

import { requestLogger } from '../middleware/request-logger'

test('credentials in request and response headers are redacted from logs', async () => {
  const app = express()
  app.use(requestLogger)
  app.get('/', (_req, res) => {
    res.cookie('refresh_token', 'refresh-secret')
    res.json({})
  })

  await request(app).get('/').set('Authorization', 'Bearer access-secret').set('Cookie', 'refresh_token=cookie-secret')

  const output = lines.join('')
  expect(output).toContain('request completed')
  expect(output).not.toContain('refresh-secret')
  expect(output).not.toContain('access-secret')
  expect(output).not.toContain('cookie-secret')
})
