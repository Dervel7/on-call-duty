import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  roleSchema,
  updateUserSchema,
} from '../index'

describe('auth schemas', () => {
  it('loginSchema rejects short password and bad email', () => {
    expect(loginSchema.safeParse({ email: 'x', password: '123' }).success).toBe(false)
    expect(
      loginSchema.safeParse({ email: 'a@b.com', password: '123456' }).success,
    ).toBe(true)
  })

  it('changePasswordSchema rejects identical passwords', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'same123',
      newPassword: 'same123',
    })
    expect(r.success).toBe(false)
  })

  it('createUserSchema validates a doctor', () => {
    expect(
      createUserSchema.safeParse({
        email: 'd@h.com',
        password: 'secret1',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
      }).success,
    ).toBe(true)
  })

  it('roleSchema rejects unknown roles', () => {
    expect(roleSchema.safeParse('nurse').success).toBe(false)
    expect(roleSchema.safeParse('doctor').success).toBe(true)
  })

  it('updateUserSchema accepts partial updates', () => {
    expect(updateUserSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(updateUserSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})

import { createDoctorSchema, updateDoctorSchema } from '../index'

describe('doctor schemas', () => {
  const valid = {
    email: 'dr@h.com',
    password: 'secret1',
    firstName: 'Jane',
    lastName: 'Roe',
  }

  it('createDoctorSchema applies default 7 and rejects out-of-range limits', () => {
    const r = createDoctorSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.maxMonthlyDuties).toBe(7)

    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 0 }).success,
    ).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 8 }).success,
    ).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, maxMonthlyDuties: 4 }).success,
    ).toBe(true)
  })

  it('createDoctorSchema rejects missing names and short password', () => {
    expect(createDoctorSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false)
    expect(
      createDoctorSchema.safeParse({ ...valid, password: '12345' }).success,
    ).toBe(false)
  })

  it('updateDoctorSchema accepts partials and enforces the range', () => {
    expect(updateDoctorSchema.safeParse({ maxMonthlyDuties: 3 }).success).toBe(true)
    expect(updateDoctorSchema.safeParse({ maxMonthlyDuties: 9 }).success).toBe(false)
    expect(updateDoctorSchema.safeParse({ isActive: false }).success).toBe(true)
  })
})

import {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '../index'

describe('unavailability schemas', () => {
  const validSelf = { type: 'vacation', startDate: '2026-09-01', endDate: '2026-09-03' }

  it('createUnavailabilityAdminSchema rejects bad type and bad date format', () => {
    expect(
      createUnavailabilityAdminSchema.safeParse({ ...validSelf, doctorId: 1, type: 'holiday' })
        .success,
    ).toBe(false)
    expect(
      createUnavailabilityAdminSchema.safeParse({
        ...validSelf,
        doctorId: 1,
        startDate: '09-01-2026',
      }).success,
    ).toBe(false)
  })

  it('createUnavailabilitySelfSchema rejects endDate before startDate', () => {
    expect(
      createUnavailabilitySelfSchema.safeParse({ ...validSelf, endDate: '2026-08-31' }).success,
    ).toBe(false)
    expect(createUnavailabilitySelfSchema.safeParse(validSelf).success).toBe(true)
  })

  it('updateUnavailabilitySchema accepts partials and null note', () => {
    expect(updateUnavailabilitySchema.safeParse({ note: null }).success).toBe(true)
    expect(updateUnavailabilitySchema.safeParse({ type: 'sick' }).success).toBe(true)
    expect(updateUnavailabilitySchema.safeParse({ type: 'nap' }).success).toBe(false)
  })

  it('unavailabilityQuerySchema coerces doctorId from string', () => {
    const r = unavailabilityQuerySchema.safeParse({ doctorId: '5', from: '2026-09-01' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.doctorId).toBe(5)
  })
})
