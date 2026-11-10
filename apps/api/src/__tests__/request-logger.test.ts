import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const { lines } = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../logger.ts', () => ({
  logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(line) }),
}))

import { requestLogger } from '../middleware/request-logger.ts'

describe('requestLogger', () => {
  it('never logs the refresh cookie or the bearer token', async () => {
    const app = express()
    app.use(requestLogger)
    app.get('/x', (_req, res) => {
      res.cookie('refresh_token', 'SECRET-COOKIE')
      res.json({ ok: true })
    })
    await request(app).get('/x').set('Authorization', 'Bearer SECRET-BEARER')
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0))
    const logged = lines.join('\n')
    expect(logged).not.toContain('SECRET-COOKIE')
    expect(logged).not.toContain('SECRET-BEARER')
  })
})
