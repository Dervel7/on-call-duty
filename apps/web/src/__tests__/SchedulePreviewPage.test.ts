import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

const preview = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
const routeRef = vi.hoisted(() => ({ route: null as { query: Record<string, string> } | null }))
vi.mock('vue-router', () => ({
  useRoute: () => routeRef.route,
  useRouter: () => ({ push: vi.fn() }),
}))

import SchedulePreviewPage from '../pages/SchedulePreviewPage.vue'
import { pickOptionFrom } from './pick-option'
import { setTestLocale } from './i18n'

function daysFor(
  year: number,
  month: number,
  openDates: Set<string> = new Set(),
  minimum: { open: number; closed: number } = { open: 1, closed: 1 },
) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return {
      date: iso,
      isWeekend: dow === 0 || dow === 6,
      dutyType: openDates.has(iso) ? ('open' as const) : ('closed' as const),
      slotsRequired: 2,
      slotsMinimum: openDates.has(iso) ? minimum.open : minimum.closed,
      eligibleDoctorIds: [5, 6],
      availableDoctorIds: [],
    }
  })
}

function deferred() {
  // Promise.withResolvers is unavailable under the repo's ES2022 lib target.
  let resolve!: (value: unknown) => void
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  routeRef.route = reactive({ query: { year: '2026', month: '9' } })
  preview.mockReset()
  generate.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
    { id: 6, userId: 6, email: 's@b.c', username: 's', firstName: 'Sam', lastName: 'Doe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulePreviewPage', () => {
  it('renders editable calendar (selects present)', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.findAll('[role="combobox"]').length).toBeGreaterThan(0)
  })

  it('blocks Generate while any day has no doctor; shows error banner', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('day(s) with no doctor')
  })

  it('assigning one doctor per day via selects enables Generate and sends the plan', async () => {
    const days = daysFor(2026, 9)
    preview.mockResolvedValue({ assignments: [], conflicts: [], days })
    generate.mockResolvedValue({
      schedule: { id: 42, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '' },
      duties: [],
      days,
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    // Two selects per day; filling the first slot of each day is enough.
    // (A day's second select no longer offers a doctor already taken by the
    // first, so only slot 0 can pick doctor 5.)
    const triggers = wrapper.findAll('[role="combobox"]')
    for (let i = 0; i < triggers.length; i += 2) {
      await pickOptionFrom(triggers[i]!.element, '5')
    }
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalled()
    const sent = generate.mock.calls[0]![2] as Array<{ date: string; doctorId: number }>
    expect(sent.length).toBe(days.length)
    expect(sent.every((a) => a.doctorId === 5)).toBe(true)
  })

  function oneDoctorPerDay(year: number, month: number, doubled: string[] = []) {
    return daysFor(year, month).flatMap((d) => [
      { date: d.date, doctorId: 5, doctorFirstName: 'Jane', doctorLastName: 'Roe', reason: 'engine' },
      ...(doubled.includes(d.date)
        ? [{ date: d.date, doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', reason: 'engine' }]
        : []),
    ])
  }

  it('blocks Generate when an open day is below its minimum', async () => {
    preview.mockResolvedValue({
      assignments: oneDoctorPerDay(2026, 9),
      conflicts: [],
      days: daysFor(2026, 9, new Set(['2026-09-10']), { open: 2, closed: 1 }),
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeDefined()
    // Only the open day is short; the day after it uses the closed minimum.
    expect(wrapper.text()).toContain('1 day(s) below their minimum')
    expect(wrapper.text()).not.toContain('Ready to generate')
  })

  it('blocks Generate when a closed day is below its minimum', async () => {
    preview.mockResolvedValue({
      assignments: oneDoctorPerDay(2026, 9, ['2026-09-10', '2026-09-11']),
      conflicts: [],
      days: daysFor(2026, 9, new Set(['2026-09-10']), { open: 1, closed: 2 }),
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('28 day(s) below their minimum')
  })

  it('allows Generate when every day meets its minimum but not its slot count', async () => {
    preview.mockResolvedValue({
      assignments: oneDoctorPerDay(2026, 9, ['2026-09-10']),
      conflicts: [],
      days: daysFor(2026, 9, new Set(['2026-09-10']), { open: 2, closed: 1 }),
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('29 day(s) below their slot count')
    expect(wrapper.text()).toContain('Ready to generate')
  })

  it('clearing the first of two assigned doctors empties only the chosen select', async () => {
    preview.mockResolvedValue({
      assignments: [
        { date: '2026-09-01', doctorId: 5, doctorFirstName: 'Jane', doctorLastName: 'Roe', reason: 'engine' },
        { date: '2026-09-01', doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', reason: 'engine' },
      ],
      conflicts: [],
      days: daysFor(2026, 9),
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const day1 = () => wrapper.findAll('[role="combobox"]').slice(0, 2)
    expect(day1().map((c) => c.text())).toEqual(['Roe J.', 'Doe S.'])

    await pickOptionFrom(day1()[0]!.element, '')
    await flushPromises()

    // The cleared select is the one that empties; the second doctor keeps its
    // slot and the button never falls back to a raw doctor id.
    expect(day1().map((c) => c.text())).toEqual(['Assign…', 'Doe S.'])
  })

  it('assigning via the second select keeps the first slot empty', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const combos = wrapper.findAll('[role="combobox"]')

    await pickOptionFrom(combos[1]!.element, '6')
    await flushPromises()

    const day1 = wrapper.findAll('[role="combobox"]').slice(0, 2)
    expect(day1.map((c) => c.text())).toEqual(['Assign…', 'Doe S.'])
  })

  it('discards a stale preview response when the month changes', async () => {
    const first = deferred()
    const second = deferred()
    preview
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    expect(preview).toHaveBeenCalledTimes(1)
    routeRef.route!.query.month = '10'
    await flushPromises()
    expect(preview).toHaveBeenCalledTimes(2)
    second.resolve({ assignments: [], conflicts: [], days: daysFor(2026, 10) })
    await flushPromises()
    expect(wrapper.text()).toContain('October 2026')
    expect(wrapper.text()).toContain('31 day(s) with no doctor')
    expect(wrapper.findAll('[role="combobox"]').length).toBe(62)
    first.resolve({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    await flushPromises()
    expect(wrapper.findAll('[role="combobox"]').length).toBe(62)
    expect(wrapper.text()).toContain('31 day(s) with no doctor')
    expect(wrapper.text()).not.toContain('September 2026')
  })

  it('clearing a slot re-queries eligibility with the updated plan and refreshes options', async () => {
    const days = daysFor(2026, 9)
    preview.mockResolvedValueOnce({
      assignments: [
        { date: '2026-09-01', doctorId: 5, doctorFirstName: 'Jane', doctorLastName: 'Roe', reason: 'engine' },
      ],
      conflicts: [],
      days,
    })
    const refreshed = days.map((d) =>
      d.date === '2026-09-01' ? { ...d, eligibleDoctorIds: [6] } : d,
    )
    preview.mockResolvedValueOnce({ assignments: [], conflicts: [], days: refreshed })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const day1 = () => wrapper.findAll('[role="combobox"]').slice(0, 2)
    expect(day1().map((c) => c.text())).toEqual(['Roe J.', 'Assign…'])

    await pickOptionFrom(day1()[0]!.element, '')
    await flushPromises()

    expect(preview).toHaveBeenCalledTimes(2)
    expect(preview.mock.calls[1]![2]).toEqual([])
    // Re-open day 1's first select: the refreshed pool offers only doctor 6.
    day1()[0]!.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const labels = [...document.body.querySelectorAll('[role="listbox"] button[data-value]')].map(
      (b) => b.textContent?.trim(),
    )
    expect(labels).toEqual(['Assign…', 'Doe S.'])
  })

  it('assigning a slot sends the growing plan on the eligibility refresh', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const combos = wrapper.findAll('[role="combobox"]')

    await pickOptionFrom(combos[0]!.element, '5')
    await flushPromises()

    expect(preview.mock.calls[1]![2]).toEqual([
      { date: '2026-09-01', doctorId: 5, reason: 'manual override' },
    ])
  })

  it('open on-call days get the red border, the OPEN badge, and the legend', async () => {
    preview.mockResolvedValue({
      assignments: [],
      conflicts: [],
      days: daysFor(2026, 9, new Set(['2026-09-05', '2026-09-13'])),
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Open on-call')
    const badges = wrapper.findAll('span').filter((s) => s.text() === 'OPEN')
    // Two calendar badges plus the legend chip render OPEN; only the badges
    // inside day cells must carry the red border.
    expect(badges).toHaveLength(3)
    const inCells = badges.filter(
      (b) => b.element.closest('[class*="border-2 border-destructive"]') !== null,
    )
    expect(inCells).toHaveLength(2)
    // Closed days keep the thin border even when empty (fill hint only).
    expect(wrapper.findAll('[class*="border-destructive/25"]').length).toBeGreaterThan(0)
  })
})

describe('SchedulePreviewPage in Greek', () => {
  it('renders the heading, status and actions in Greek', async () => {
    setTestLocale('el')
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const heading = wrapper.find('h1').text()
    expect(heading).toContain('2026')
    expect(heading).not.toContain('September')
    expect(wrapper.text()).toContain('30 ημέρα(-ες) χωρίς ιατρό')
    expect(wrapper.text()).toContain('Ανοιχτή εφημερία')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Δημιουργία προγράμματος')).toBe(true)
  })
})
