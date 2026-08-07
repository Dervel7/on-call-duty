import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  roleSchema,
  updateUserSchema,
  usernameSchema,
} from '../index'

describe('auth schemas', () => {
  it('loginSchema requires identifier + min-6 password', () => {
    expect(loginSchema.safeParse({ identifier: '', password: '123456' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'a@b.com', password: '12345' }).success).toBe(false)
    expect(loginSchema.safeParse({ identifier: 'a@b.com', password: '123456' }).success).toBe(true)
    expect(loginSchema.safeParse({ identifier: 'admin', password: '123456' }).success).toBe(true)
  })

  it('usernameSchema enforces the 3-32 alnum/._- format', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
    expect(usernameSchema.safeParse('a@b').success).toBe(false)
    expect(usernameSchema.safeParse('has space').success).toBe(false)
    expect(usernameSchema.safeParse('admin.1_ok').success).toBe(true)
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
        username: 'dr1',
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
    username: 'dr1',
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

import {
  createDutySchema,
  createHolidaySchema,
  createScheduleSchema,
  holidayQuerySchema,
  reassignDutySchema,
  scheduleQuerySchema,
  updateHolidaySchema,
} from '../index'

describe('schedule schemas', () => {
  it('createScheduleSchema rejects bad month/year', () => {
    expect(createScheduleSchema.safeParse({ year: 2026, month: 0 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 13 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 9 }).success).toBe(true)
  })

  it('scheduleQuerySchema and holidayQuerySchema coerce/accept strings', () => {
    const r = scheduleQuerySchema.safeParse({ year: '2026', month: '9' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.year).toBe(2026)
      expect(r.data.month).toBe(9)
    }
    expect(holidayQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(true)
    expect(holidayQuerySchema.safeParse({ from: '09-01-2026' }).success).toBe(false)
  })

  it('createHolidaySchema rejects bad date and empty name', () => {
    expect(createHolidaySchema.safeParse({ name: '', date: '2026-09-01' }).success).toBe(false)
    expect(createHolidaySchema.safeParse({ name: 'Day', date: '2026-9-1' }).success).toBe(false)
    expect(createHolidaySchema.safeParse({ name: 'Day', date: '2026-09-01' }).success).toBe(true)
  })

  it('updateHolidaySchema accepts partials', () => {
    expect(updateHolidaySchema.safeParse({ name: 'X' }).success).toBe(true)
    expect(updateHolidaySchema.safeParse({ date: '2026-09-01' }).success).toBe(true)
    expect(updateHolidaySchema.safeParse({ date: 'bad' }).success).toBe(false)
  })

  it('createDutySchema and reassignDutySchema reject non-positive doctorId', () => {
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 0 }).success).toBe(false)
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 5 }).success).toBe(true)
    expect(reassignDutySchema.safeParse({ doctorId: -1 }).success).toBe(false)
    expect(reassignDutySchema.safeParse({ doctorId: 5 }).success).toBe(true)
  })
})
