import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DayInfo } from '@oncall/shared'

import DutyCalendar from '../components/schedule/DutyCalendar.vue'

function day(date: string, slotsRequired: number): DayInfo {
  return { date, isWeekend: false, dutyType: 'closed', slotsRequired, eligibleDoctorIds: [], availableDoctorIds: [] }
}

const assigned = { doctorId: 5, firstName: 'Jane', lastName: 'Roe', reason: '' }

function mountCalendar(slotsRequired: number, filled: number) {
  return mount(DutyCalendar, {
    props: {
      year: 2026,
      month: 9,
      days: [day('2026-09-01', slotsRequired)],
      assignmentByDate: new Map([['2026-09-01', Array.from({ length: filled }, (_, i) => ({ ...assigned, doctorId: 5 + i }))]]),
      conflictsByDate: new Map(),
      doctors: [],
      mode: 'editable',
      showFillHints: true,
    },
  })
}

describe('DutyCalendar', () => {
  it('names each slot select by date and slot number', () => {
    const w = mountCalendar(2, 0)
    expect(w.findAll('[role="combobox"]').map((c) => c.attributes('aria-label'))).toEqual([
      '2026-09-01 slot 1',
      '2026-09-01 slot 2',
    ])
  })

  it.each([
    [3, 2, '2 of 3'],
    [3, 1, '1 of 3'],
    [2, 1, '1 of 2'],
  ])('slotsRequired=%i with %i doctors shows %s', (slots, filled, hint) => {
    expect(mountCalendar(slots, filled).text()).toContain(hint)
  })

  it('shows no partial hint when the day is fully staffed', () => {
    const w = mountCalendar(1, 1)
    expect(w.text()).not.toMatch(/\d of \d/)
    expect(w.text()).not.toContain('No doctor')
  })

  it('highlights the local today just after local midnight', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Pacific/Auckland'
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 00:30 on Oct 1 in Auckland is still Sep 30 in UTC.
      vi.setSystemTime(new Date(2026, 9, 1, 0, 30))
      const w = mount(DutyCalendar, {
        props: {
          year: 2026,
          month: 10,
          days: [day('2026-09-30', 1), day('2026-10-01', 1)],
          assignmentByDate: new Map(),
          doctors: [],
          mode: 'readonly',
        },
      })
      expect(w.findAll('.rounded-full.bg-primary').map((s) => s.text())).toEqual(['1'])
    } finally {
      vi.useRealTimers()
      process.env.TZ = tz
    }
  })
})
