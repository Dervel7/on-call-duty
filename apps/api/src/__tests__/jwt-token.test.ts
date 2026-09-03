import { env } from '../config/env'
import jwt from 'jsonwebtoken'
import { signAccessToken, verifyAccessToken } from '../lib/jwt'
import { generateRefreshToken, hashToken } from '../lib/token'

describe('jwt', () => {
  it('round-trips the payload', () => {
    const t = signAccessToken({ sub: 7, role: 'doctor' })
    const p = verifyAccessToken(t)
    expect(p.sub).toBe(7)
    expect(p.role).toBe('doctor')
  })

  it('rejects a token signed with a different secret', () => {
    const t = jwt.sign({ sub: 1, role: 'doctor' }, 'wrong-secret')
    expect(() => verifyAccessToken(t)).toThrow()
  })

  it('rejects a token signed with a non-pinned algorithm', () => {
    const t = jwt.sign({ sub: 1, role: 'doctor' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS384',
    })
    expect(() => verifyAccessToken(t)).toThrow()
  })

  it('rejects a syntactically valid token with a bad payload shape', () => {
    const t = jwt.sign({ sub: 'not-a-number', role: 'doctor' }, env.JWT_ACCESS_SECRET)
    expect(() => verifyAccessToken(t)).toThrow()
    const t2 = jwt.sign({ sub: 1, role: 'wizard' }, env.JWT_ACCESS_SECRET)
    expect(() => verifyAccessToken(t2)).toThrow()
  })
})

describe('refresh token helpers', () => {
  it('hashToken is deterministic and differs from input', () => {
    const a = hashToken('abc')
    const b = hashToken('abc')
    expect(a).toBe(b)
    expect(a).not.toBe('abc')
    expect(a).toHaveLength(64)
  })

  it('generateRefreshToken produces unique opaque tokens', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(43)
  })
})
