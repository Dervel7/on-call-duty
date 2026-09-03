import { type PoolClient, type QueryResult, type QueryResultRow, Pool, types } from 'pg'
import { env } from '../config/env'
import { logger } from '../logger'

const DATE_OID = 1082
types.setTypeParser(DATE_OID, (val: string) => val)

export const pool = new Pool({ connectionString: env.DATABASE_URL })

// An idle client that hits a connection error emits 'error' on the pool;
// without a listener Node terminates the process (pg requires this handler).
pool.on('error', (err) => {
  logger.error({ err }, 'idle pg client error')
})

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query(text, params) as Promise<QueryResult<T>>
}

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Connection already broken — never mask the original error.
    }
    throw err
  } finally {
    client.release()
  }
}
