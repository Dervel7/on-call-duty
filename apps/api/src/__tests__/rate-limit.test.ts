import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'

vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'development' },
}))

import { rateLimit } from '../middleware/rate-limit'
import { HttpError } from '../lib/http-error'

describe('rateLimit', () => {
  it('allows up to the limit, then rejects with 429', () => {
    const mw = rateLimit({ windowMs: 60_000, limit: 3, keyFn: () => '1.2.3.4' })
    const next = (() => {}) as NextFunction
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      try {
        mw({} as Request, {} as Response, next)
        statuses.push(200)
      } catch (err) {
        statuses.push(err instanceof HttpError ? err.status : 500)
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429])
  })

  it('tracks keys independently', () => {
    const mw = rateLimit({ windowMs: 60_000, limit: 1, keyFn: (req) => String((req as { ip?: string }).ip) })
    const next = (() => {}) as NextFunction
    mw({ ip: 'a' } as Request, {} as Response, next)
    expect(() => mw({ ip: 'a' } as Request, {} as Response, next)).toThrow(HttpError)
    expect(() => mw({ ip: 'b' } as Request, {} as Response, next)).not.toThrow()
  })
})
