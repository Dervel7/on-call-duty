import { describe, expect, it } from 'vitest'
import {
  activityQuerySchema,
  changePasswordSchema,
  createClinicSchema,
  createDutySchema,
  createScheduleSchema,
  createUserSchema,
  generateScheduleSchema,
  isoDateSchema,
  loginSchema,
  reassignDutySchema,
  resetUserPasswordSchema,
  roleSchema,
  scheduleQuerySchema,
  statsQuerySchema,
  reportQuerySchema,
  updateClinicSchema,
  updateUserSchema,
  updateThemeSchema,
  usernameSchema,
} from '../index'

describe('date and password primitives', () => {
  it('isoDateSchema rejects calendar-invalid but well-formed dates', () => {
    expect(isoDateSchema.safeParse('2026-09-17').success).toBe(true)
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false) // not a leap year
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false)
    expect(isoDateSchema.safeParse('2026-9-7').success).toBe(false)
  })


  it('passwords over 72 bytes are rejected (bcrypt truncation)', () => {
    expect(loginSchema.safeParse({ identifier: 'a', password: 'x'.repeat(72) }).success).toBe(true)
    expect(loginSchema.safeParse({ identifier: 'a', password: 'x'.repeat(73) }).success).toBe(false)
    // 40 two-byte chars = 80 bytes
    expect(loginSchema.safeParse({ identifier: 'a', password: 'α'.repeat(40) }).success).toBe(false)
  })
})

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
  it('resetUserPasswordSchema requires only a valid newPassword', () => {
    expect(resetUserPasswordSchema.safeParse({ newPassword: 'secret1' }).success).toBe(true)
    expect(resetUserPasswordSchema.safeParse({ newPassword: 'abc' }).success).toBe(false)
    expect(resetUserPasswordSchema.safeParse({}).success).toBe(false)
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

  it('roleSchema rejects unknown roles and accepts manager', () => {
    expect(roleSchema.safeParse('nurse').success).toBe(false)
    expect(roleSchema.safeParse('doctor').success).toBe(true)
    expect(roleSchema.safeParse('manager').success).toBe(true)
    expect(roleSchema.safeParse('superadmin').success).toBe(true)
  })

  it('updateUserSchema accepts partial updates', () => {
    expect(updateUserSchema.safeParse({ isActive: false }).success).toBe(true)
    expect(updateUserSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })

  it('updateThemeSchema accepts only a boolean darkMode', () => {
    expect(updateThemeSchema.safeParse({ darkMode: true }).success).toBe(true)
    expect(updateThemeSchema.safeParse({ darkMode: false }).success).toBe(true)
    expect(updateThemeSchema.safeParse({ darkMode: 'yes' }).success).toBe(false)
    expect(updateThemeSchema.safeParse({}).success).toBe(false)
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
  setUnavailabilityDisabledSchema,
  updateUnavailabilitySchema,
} from '../index'

describe('unavailability schemas', () => {
  const validSelf = { startDate: '2026-09-01', endDate: '2026-09-03' }

  it('createUnavailabilityAdminSchema rejects a bad date format and bad doctorId', () => {
    expect(
      createUnavailabilityAdminSchema.safeParse({
        ...validSelf,
        doctorId: 1,
        startDate: '09-01-2026',
      }).success,
    ).toBe(false)
    expect(createUnavailabilityAdminSchema.safeParse({ ...validSelf, doctorId: -1 }).success).toBe(
      false,
    )
  })

  it('createUnavailabilitySelfSchema rejects endDate before startDate', () => {
    expect(
      createUnavailabilitySelfSchema.safeParse({ ...validSelf, endDate: '2026-08-31' }).success,
    ).toBe(false)
    expect(createUnavailabilitySelfSchema.safeParse(validSelf).success).toBe(true)
  })

  it('updateUnavailabilitySchema accepts partials and rejects inverted ranges', () => {
    expect(updateUnavailabilitySchema.safeParse({ endDate: '2026-09-12' }).success).toBe(true)
    expect(
      updateUnavailabilitySchema.safeParse({ startDate: '2026-09-12', endDate: '2026-09-01' })
        .success,
    ).toBe(false)
  })

  it('setUnavailabilityDisabledSchema requires a boolean isDisabled', () => {
    expect(setUnavailabilityDisabledSchema.safeParse({ isDisabled: true }).success).toBe(true)
    expect(setUnavailabilityDisabledSchema.safeParse({ isDisabled: false }).success).toBe(true)
    expect(setUnavailabilityDisabledSchema.safeParse({}).success).toBe(false)
    expect(setUnavailabilityDisabledSchema.safeParse({ isDisabled: 'yes' }).success).toBe(false)
  })

  it('unavailabilityQuerySchema coerces doctorId from string', () => {
    const r = unavailabilityQuerySchema.safeParse({ doctorId: '5', from: '2026-09-01' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.doctorId).toBe(5)
  })
})


describe('schedule schemas', () => {
  it('createScheduleSchema rejects bad month/year', () => {
    expect(createScheduleSchema.safeParse({ year: 2026, month: 0 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 13 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 9 }).success).toBe(true)
  })

  it('scheduleQuerySchema coerces/accepts strings', () => {
    const r = scheduleQuerySchema.safeParse({ year: '2026', month: '9' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.year).toBe(2026)
      expect(r.data.month).toBe(9)
    }
  })


  it('createDutySchema and reassignDutySchema reject non-positive doctorId', () => {
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 0 }).success).toBe(false)
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 5 }).success).toBe(true)
    expect(reassignDutySchema.safeParse({ doctorId: -1 }).success).toBe(false)
    expect(reassignDutySchema.safeParse({ doctorId: 5 }).success).toBe(true)
  })

  it('generateScheduleSchema accepts with/without assignments and validates items', () => {
    expect(generateScheduleSchema.safeParse({ year: 2026, month: 9 }).success).toBe(true)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-09-01', doctorId: 5 }],
      }).success,
    ).toBe(true)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-9-1', doctorId: 5 }],
      }).success,
    ).toBe(false)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-09-01', doctorId: 0 }],
      }).success,
    ).toBe(false)
  })
})

import { updateBillingSchema } from '../index'

describe('billing schemas', () => {
  it('updateBillingSchema accepts a real calendar date and rejects malformed ones', () => {
    expect(updateBillingSchema.safeParse({ paidThrough: '2026-12-31' }).success).toBe(true)
    expect(updateBillingSchema.safeParse({ paidThrough: '2026-02-30' }).success).toBe(false)
    expect(updateBillingSchema.safeParse({ paidThrough: 'oops' }).success).toBe(false)
  })
})

describe('clinic schemas and clinicId query params', () => {
  it('scheduleQuerySchema coerces clinicId and rejects 0, -1 and non-numbers', () => {
    const ok = scheduleQuerySchema.safeParse({ clinicId: '3' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.clinicId).toBe(3)
    expect(scheduleQuerySchema.safeParse({ clinicId: 0 }).success).toBe(false)
    expect(scheduleQuerySchema.safeParse({ clinicId: -1 }).success).toBe(false)
    expect(scheduleQuerySchema.safeParse({ clinicId: 'abc' }).success).toBe(false)
  })

  it('activityQuerySchema, statsQuerySchema and reportQuerySchema accept clinicId', () => {
    for (const schema of [activityQuerySchema, statsQuerySchema, reportQuerySchema]) {
      expect(schema.safeParse({ clinicId: '2' }).success).toBe(true)
      expect(schema.safeParse({ clinicId: -1 }).success).toBe(false)
    }
  })

  it('createClinicSchema enforces trimmed 2-80 char names', () => {
    expect(createClinicSchema.safeParse({ name: 'Radiology' }).success).toBe(true)
    expect(createClinicSchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(createClinicSchema.safeParse({ name: '' }).success).toBe(false)
    expect(createClinicSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false)
    const trimmed = createClinicSchema.safeParse({ name: '  Cardiology  ' })
    expect(trimmed.success).toBe(true)
    if (trimmed.success) expect(trimmed.data.name).toBe('Cardiology')
  })

  it('updateClinicSchema requires at least one field', () => {
    expect(updateClinicSchema.safeParse({}).success).toBe(false)
    expect(updateClinicSchema.safeParse({ name: 'Neurology' }).success).toBe(true)
    expect(updateClinicSchema.safeParse({ isActive: false }).success).toBe(true)
  })
})
