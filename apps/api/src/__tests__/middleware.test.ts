import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

function build() {
  const app = express()
  app.use(express.json())
  app.post('/v', validate(z.object({ x: z.string().min(2) }), 'body'), (_req, res) =>
    res.status(200).json({ success: true, data: { ok: true } }),
  )
  app.get('/me', authenticate, (req, res) =>
    res.status(200).json({ success: true, data: { id: req.user?.id, role: req.user?.role } }),
  )
  app.get('/admin', authenticate, authorize('administrator'), (_req, res) =>
    res.status(200).json({ success: true, data: { ok: true } }),
  )
  app.use(errorHandler)
  return app
}

test('validate rejects bad body with 400', async () => {
  const res = await request(build()).post('/v').send({ x: 'a' })
  expect(res.status).toBe(400)
})

test('authenticate requires bearer token', async () => {
  const res = await request(build()).get('/me')
  expect(res.status).toBe(401)
})

test('authenticate attaches req.user from valid token', async () => {
  const token = signAccessToken({ sub: 42, role: 'doctor' })
  const res = await request(build()).get('/me').set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  expect(res.body.data).toEqual({ id: 42, role: 'doctor' })
})

test('authorize forbids non-admin (403) and allows admin (200)', async () => {
  const app = build()
  const doc = signAccessToken({ sub: 1, role: 'doctor' })
  const adm = signAccessToken({ sub: 2, role: 'administrator' })
  expect((await request(app).get('/admin').set('Authorization', `Bearer ${doc}`)).status).toBe(403)
  expect((await request(app).get('/admin').set('Authorization', `Bearer ${adm}`)).status).toBe(200)
})
