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
  app.get('/boom', (_req, _res, next) => next(new Error('duplicate key value violates unique constraint "users_email_key"')))
  app.get('/pg-unique', (_req, _res, next) => {
    const err = new Error('duplicate key value violates unique constraint "schedules_year_month_key"')
    Object.assign(err, { code: '23505' })
    next(err)
  })
  app.get('/parser', (_req, _res, next) => {
    const err = new Error('request entity too large')
    Object.assign(err, { status: 413 })
    next(err)
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

test('pg unique violation maps to 409 without leaking constraint names', async () => {
  const res = await request(build()).get('/pg-unique')
  expect(res.status).toBe(409)
  expect(res.body).toEqual({ success: false, error: 'Resource already exists' })
})

test('unknown errors return a generic 500 message', async () => {
  const res = await request(build()).get('/boom')
  expect(res.status).toBe(500)
  expect(res.body).toEqual({ success: false, error: 'Internal server error' })
})

test('framework sub-500 statuses pass through with their message', async () => {
  const res = await request(build()).get('/parser')
  expect(res.status).toBe(413)
  expect(res.body).toEqual({ success: false, error: 'request entity too large' })
})
