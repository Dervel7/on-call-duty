import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const listHolidays = vi.fn()
const setMonthHolidays = vi.fn()
vi.mock('@/services/holiday', () => ({
  listHolidays: (...a: unknown[]) => listHolidays(...a),
  setMonthHolidays: (...a: unknown[]) => setMonthHolidays(...a),
}))

import HolidaysPage from '../pages/HolidaysPage.vue'

function holiday(date: string) {
  return { id: 1, clinicId: 1, date }
}

function mountAsAdmin() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = {
    id: 1,
    email: 'u@h.com',
    username: 'u1',
    role: 'administrator',
    firstName: 'Jane',
    lastName: 'Roe',
    darkMode: false,
    clinicId: 1,
    clinicName: 'Main Clinic',
  }
  return mount(HolidaysPage, { global: { plugins: [pinia] } })
}

const year = new Date().getFullYear()
const month = new Date().getMonth() + 1
const pad = (n: number) => String(n).padStart(2, '0')
const monthStr = `${year}-${pad(month)}`

/** First Saturday of the current month as an ISO date. */
const firstSaturday = (() => {
  const d = new Date(year, month - 1, 1)
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1)
  return `${monthStr}-${pad(d.getDate())}`
})()

/** First weekday (Mon–Fri) of the current month as an ISO date. */
const firstWeekday = (() => {
  const d = new Date(year, month - 1, 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return `${monthStr}-${pad(d.getDate())}`
})()

beforeEach(() => {
  listHolidays.mockReset()
  setMonthHolidays.mockReset()
})

describe('HolidaysPage', () => {
  it('loads the current month and renders marked days as holidays', async () => {
    listHolidays.mockResolvedValue([holiday(firstWeekday)])
    const wrapper = mountAsAdmin()
    await flushPromises()
    expect(listHolidays).toHaveBeenCalledWith(year, 1)
    const day = wrapper.find(`button[data-date="${firstWeekday}"]`)
    expect(day.exists()).toBe(true)
    expect(day.classes()).toContain('bg-primary/15')
  })

  it('renders weekends as holidays and does not toggle them', async () => {
    listHolidays.mockResolvedValue([])
    const wrapper = mountAsAdmin()
    await flushPromises()
    const sat = wrapper.find(`button[data-date="${firstSaturday}"]`)
    expect(sat.exists()).toBe(true)
    expect(sat.attributes('disabled')).toBeDefined()
    expect(sat.classes()).toContain('bg-muted/40')
    await sat.trigger('click')
    expect(wrapper.text()).not.toContain('Save')
  })

  it('toggling a weekday then Save calls setMonthHolidays with the month payload', async () => {
    listHolidays.mockResolvedValue([holiday(firstWeekday)])
    const wrapper = mountAsAdmin()
    await flushPromises()
    const other = nextWeekdayAfter(firstWeekday)
    await wrapper.find(`button[data-date="${other}"]`).trigger('click')
    const save = wrapper.findAll('button').find((b) => b.text() === 'Save')!
    setMonthHolidays.mockResolvedValue([
      holiday(firstWeekday),
      holiday(other),
    ])
    await save.trigger('click')
    await flushPromises()
    expect(setMonthHolidays).toHaveBeenCalledWith(year, month, [firstWeekday, other])
    // Saved state clears the dirty flag — Save disappears.
    expect(wrapper.findAll('button').some((b) => b.text() === 'Save')).toBe(false)
  })

  it('shows an error when loading fails', async () => {
    listHolidays.mockRejectedValue(new Error('boom'))
    const wrapper = mountAsAdmin()
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
  })
})

function nextWeekdayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  do {
    d.setDate(d.getDate() + 1)
  } while (d.getDay() === 0 || d.getDay() === 6 || d.getMonth() + 1 !== month)
  return `${monthStr}-${pad(d.getDate())}`
}
