import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, release, connect } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}))

vi.mock('../config/env', () => ({
  env: { DATABASE_URL: 'postgres://x', LOG_LEVEL: 'silent', NODE_ENV: 'test' },
}))
vi.mock('pg', () => {
  class Pool {
    connect = connect
    on = vi.fn()
  }
  return { Pool, types: { setTypeParser: () => {} } }
})

import { withTransaction } from '../db/client'

beforeEach(() => {
  query.mockReset()
  release.mockReset()
  connect.mockReset()
  connect.mockResolvedValue({ query, release })
})

describe('withTransaction', () => {
  it('runs BEGIN / work / COMMIT and releases on success', async () => {
    const calls: string[] = []
    query.mockImplementation(async (sql: string) => {
      calls.push(sql)
      return { rows: [] }
    })
    const result = await withTransaction(async (client) => {
      await client.query('SELECT 1')
      return 42
    })
    expect(result).toBe(42)
    expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT'])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('runs ROLLBACK and rethrows on failure', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      withTransaction(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
