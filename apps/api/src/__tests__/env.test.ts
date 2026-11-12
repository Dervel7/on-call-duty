import { describe, expect, it } from 'vitest'
import { envSchema } from '../config/env.ts'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
}

describe('envSchema', () => {
  it('accepts a minimal valid environment with defaults', () => {
    const r = envSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.TRUST_PROXY).toBe(1)
  })

  it.each([
    ['JWT_ACCESS_EXPIRES_IN', '15 minutes'],
    ['LOG_LEVEL', 'verbose'],
    ['COOKIE_SECURE', 'TRUE'],
    ['COOKIE_SECURE', '1'],
    ['TRUST_PROXY', '-1'],
    ['TRUST_PROXY', 'abc'],
  ])('rejects %s=%s', (key, value) => {
    expect(envSchema.safeParse({ ...base, [key]: value }).success).toBe(false)
  })

  it('parses TRUST_PROXY as a number', () => {
    const r = envSchema.safeParse({ ...base, TRUST_PROXY: '2' })
    expect(r.success && r.data.TRUST_PROXY).toBe(2)
  })
})
