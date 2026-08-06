import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

import { issueRefreshToken, revokeAllForUser, rotateRefreshToken } from '../services/token.service'
import { hashToken } from '../lib/token'

function returning(rows: unknown) {
  return async () => ({ rows })
}

beforeEach(() => query.mockReset())

describe('token.service', () => {
  it('issueRefreshToken inserts a hashed token', async () => {
    query.mockImplementation(returning([]))
    const token = await issueRefreshToken(5)
    expect(typeof token).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('INSERT INTO refresh_tokens')
    const params = query.mock.calls[0]?.[1] as unknown[]
    expect(params?.[1]).toBe(hashToken(token))
  })

  it('rotateRefreshToken throws on unknown token', async () => {
    query.mockImplementation(returning([]))
    await expect(rotateRefreshToken('nope')).rejects.toMatchObject({ status: 401 })
  })

  it('rotateRefreshToken throws on revoked token and revokes the family chain', async () => {
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return {
          rows: [
            {
              id: 1,
              user_id: 9,
              expires_at: new Date(Date.now() + 10000),
              revoked_at: new Date(),
              replaced_by: 2,
            },
          ],
        }
      }
      return { rows: [] }
    })
    await expect(rotateRefreshToken('reused')).rejects.toMatchObject({ status: 401 })
    const updateCall = query.mock.calls.find((c) => String(c[0]).includes('id = ANY'))
    expect(updateCall).toBeDefined()
    const arrayParam = (updateCall?.[1] as unknown[])[0] as number[]
    expect(arrayParam).toContain(1)
  })

  it('rotateRefreshToken issues a new token and revokes the old row', async () => {
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return {
          rows: [
            {
              id: 1,
              user_id: 9,
              expires_at: new Date(Date.now() + 100000),
              revoked_at: null,
              replaced_by: null,
            },
          ],
        }
      }
      if (calls === 2) return { rows: [{ id: 2 }] }
      return { rows: [] }
    })
    const res = await rotateRefreshToken('good')
    expect(res.userId).toBe(9)
    expect(typeof res.token).toBe('string')
    const updateSql = query.mock.calls[2]?.[0] as string
    expect(updateSql).toContain('replaced_by')
  })

  it('revokeAllForUser updates active tokens', async () => {
    query.mockImplementation(returning([]))
    await revokeAllForUser(3)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('UPDATE refresh_tokens')
    expect((query.mock.calls[0]?.[1] as unknown[])[0]).toBe(3)
  })
})
