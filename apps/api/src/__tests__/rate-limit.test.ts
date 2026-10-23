import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'

vi.mock('../config/env.ts', () => ({
  env: { NODE_ENV: 'development' },
}))

import { rateLimit, refreshSessionKey } from '../middleware/rate-limit.ts'
import { HttpError } from '../lib/http-error.ts'

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

describe('refreshSessionKey', () => {
  const next = (() => {}) as NextFunction
  const request = (ip: string, token?: string) =>
    ({ ip, cookies: token ? { refresh_token: token } : {} }) as unknown as Request

  it('gives each refresh session behind one NAT address its own budget', () => {
    const mw = rateLimit({ windowMs: 60_000, limit: 1, keyFn: refreshSessionKey })
    mw(request('10.0.0.1', 'session-a'), {} as Response, next)
    expect(() => mw(request('10.0.0.1', 'session-b'), {} as Response, next)).not.toThrow()
    expect(() => mw(request('10.0.0.1', 'session-a'), {} as Response, next)).toThrow(HttpError)
  })

  it('falls back to the client address when there is no refresh cookie', () => {
    const mw = rateLimit({ windowMs: 60_000, limit: 1, keyFn: refreshSessionKey })
    mw(request('10.0.0.1'), {} as Response, next)
    expect(() => mw(request('10.0.0.1'), {} as Response, next)).toThrow(HttpError)
    expect(() => mw(request('10.0.0.2'), {} as Response, next)).not.toThrow()
  })
})
