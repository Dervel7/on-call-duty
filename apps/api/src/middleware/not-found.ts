import type { Request, Response } from 'express'
import { fail } from '../lib/envelope.ts'

export function notFound(_req: Request, res: Response): void {
  res.status(404).json(fail('Not found'))
}
