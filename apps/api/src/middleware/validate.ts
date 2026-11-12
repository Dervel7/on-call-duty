import type { NextFunction, Request, Response } from 'express'
import type { ZodTypeAny } from 'zod'

type Part = 'body' | 'params' | 'query'

export function validate(schema: ZodTypeAny, part: Part) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req[part] = schema.parse(req[part])
    next()
  }
}
