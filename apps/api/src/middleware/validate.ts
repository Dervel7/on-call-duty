import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'
import { HttpError } from '../lib/http-error'

type Part = 'body' | 'params' | 'query'

export function validate(schema: ZodTypeAny, part: Part) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part])
    if (!result.success) {
      throw new HttpError(400, result.error.issues[0]?.message ?? 'Validation failed')
    }
    req[part] = result.data
    next()
  }
}
