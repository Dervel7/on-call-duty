import { describe, expect, it } from 'vitest'
import type { ApiResponse, Role } from '../index'

describe('shared types', () => {
  it('compile and produce values', () => {
    const ok: ApiResponse<{ status: string }> = {
      success: true,
      data: { status: 'ok' },
    }
    const role: Role = 'doctor'
    expect(ok).toBeTruthy()
    expect(role).toBeTruthy()
  })
})
