import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { issueRefreshToken, revokeAllForUser, rotateRefreshToken } from '../services/token.service'
import { hashToken } from '../lib/token'

function returning(rows: unknown) {
  return async () => ({ rows })
}

function liveRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    user_id: 9,
    expires_at: new Date(Date.now() + 100_000),
    revoked_at: null,
    replaced_by: null,
    ...overrides,
  }
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
      if (calls === 1) return { rows: [liveRow({ revoked_at: new Date(), replaced_by: 2 })] }
      if (calls === 2) return { rows: [{ id: 1 }, { id: 2 }] } // recursive-CTE family
      return { rows: [] }
    })
    await expect(rotateRefreshToken('reused')).rejects.toMatchObject({ status: 401 })
    const familyCall = query.mock.calls[1]?.[0] as string
    expect(familyCall).toContain('WITH RECURSIVE')
    const updateCall = query.mock.calls.find((c) => String(c[0]).includes('id = ANY'))
    expect(updateCall).toBeDefined()
    const arrayParam = (updateCall?.[1] as unknown[])[0] as number[]
    expect(arrayParam).toContain(1)
    expect(arrayParam).toContain(2)
  })

  it('rotateRefreshToken issues a new token and revokes the old row', async () => {
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) return { rows: [liveRow()] }
      if (calls === 2) return { rows: [{ id: 2 }] } // INSERT new token
      return { rows: [{ id: 1 }] } // atomic claim UPDATE returns the row
    })
    const res = await rotateRefreshToken('good')
    expect(res.userId).toBe(9)
    expect(typeof res.token).toBe('string')
    const claimSql = query.mock.calls[2]?.[0] as string
    expect(claimSql).toContain('replaced_by')
    expect(claimSql).toContain('revoked_at IS NULL')
  })

  it('rotateRefreshToken detects a lost rotation race and revokes the family', async () => {
    // The atomic claim matches zero rows: a concurrent refresh already
    // consumed the token. Reuse must revoke the whole chain.
    let calls = 0
    query.mockImplementation(async () => {
      calls++
      if (calls === 1) return { rows: [liveRow()] }
      if (calls === 2) return { rows: [{ id: 2 }] } // INSERT new token (rolled back)
      if (calls === 3) return { rows: [] } // claim matches nothing
      if (calls === 4) return { rows: [{ id: 1 }, { id: 2 }] } // family walk
      return { rows: [] }
    })
    await expect(rotateRefreshToken('raced')).rejects.toMatchObject({ status: 401 })
    const updateCall = query.mock.calls.find((c) => String(c[0]).includes('id = ANY'))
    expect(updateCall).toBeDefined()
  })

  it('revokeAllForUser updates active tokens', async () => {
    query.mockImplementation(returning([]))
    await revokeAllForUser(3)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('UPDATE refresh_tokens')
    expect((query.mock.calls[0]?.[1] as unknown[])[0]).toBe(3)
  })
})
