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
