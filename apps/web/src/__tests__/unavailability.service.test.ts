import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Unavailability } from '@oncall/shared'

const apiPost = vi.fn()
const apiDelete = vi.fn()
vi.mock('@/lib/http', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
}))

import { removeDay } from '../services/unavailability'

const record: Unavailability = {
  id: 7,
  doctorId: 5,
  doctorFirstName: 'Jane',
  doctorLastName: 'Roe',
  startDate: '2026-09-07',
  endDate: '2026-09-11',
  isDisabled: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

afterEach(() => {
  apiPost.mockReset()
  apiDelete.mockReset()
})

describe('unavailability service removeDay', () => {
  it('deletes the record when the day is its only day', async () => {
    apiDelete.mockResolvedValue(undefined)
    await removeDay({ ...record, endDate: '2026-09-07' }, '2026-09-07')
    expect(apiDelete).toHaveBeenCalledWith('/unavailability/7')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('splits the record around a middle day', async () => {
    apiPost.mockResolvedValue({ unavailability: [] })
    await removeDay(record, '2026-09-09')
    expect(apiPost).toHaveBeenCalledWith('/unavailability/7/split', {
      segments: [
        { startDate: '2026-09-07', endDate: '2026-09-08' },
        { startDate: '2026-09-10', endDate: '2026-09-11' },
      ],
    })
    expect(apiDelete).not.toHaveBeenCalled()
  })
})
