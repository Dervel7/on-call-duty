import { type QueryResult, type QueryResultRow, Pool } from 'pg'
import { env } from '../config/env'

export const pool = new Pool({ connectionString: env.DATABASE_URL })

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query(text, params) as Promise<QueryResult<T>>
}
