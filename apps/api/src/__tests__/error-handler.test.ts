import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { HttpError } from '../lib/http-error'
import { errorHandler } from '../middleware/error-handler'

function build() {
  const app = express()
  app.use(express.json())
  app.get('/http', (_req, _res, next) => next(new HttpError(409, 'taken')))
  app.post('/zod', (req, _res, next) => {
    const r = z.object({ x: z.string().min(3) }).safeParse(req.body)
    if (!r.success) throw r.error
    next()
  })
  app.use(errorHandler)
  return app
}

test('HttpError status is respected', async () => {
  const res = await request(build()).get('/http')
  expect(res.status).toBe(409)
  expect(res.body).toEqual({ success: false, error: 'taken' })
})

test('ZodError maps to 400', async () => {
  const res = await request(build()).post('/zod').send({ x: 'a' })
  expect(res.status).toBe(400)
  expect(res.body.success).toBe(false)
})
