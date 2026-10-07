import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { AssignmentPlan, DayInfo, ScheduleOption } from '@oncall/shared'
import { ApiError } from '@/lib/http'

const options = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  options: (...a: unknown[]) => options(...a),
  generate: (...a: unknown[]) => generate(...a),
  preview: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const push = vi.fn()
const replace = vi.fn()
const routeRef = vi.hoisted(() => ({ route: { query: {} as Record<string, string> } }))
vi.mock('vue-router', () => ({
  useRoute: () => routeRef.route,
  useRouter: () => ({ push, replace }),
}))

import ScheduleOptionsPage from '../pages/ScheduleOptionsPage.vue'
import { useConfirmState } from '../composables/useConfirm'

const { settle } = useConfirmState()

const JANE = { doctorId: 5, doctorFirstName: 'Jane', doctorLastName: 'Roe' }
const SAM = { doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe' }

const days: DayInfo[] = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date) => ({
  date,
  isWeekend: false,
  dutyType: 'closed',
  slotsRequired: 1,
  slotsMinimum: 1,
  eligibleDoctorIds: [5, 6],
  availableDoctorIds: [5, 6],
}))

function duty(date: string, doctor: typeof JANE): AssignmentPlan {
  return { date, ...doctor, isWeekend: false, reason: `solver optimal ${date}` }
}

function option(
  index: number,
  assignments: AssignmentPlan[],
  changedDates: string[],
  conflicts: ScheduleOption['conflicts'] = [],
): ScheduleOption {
  return { index, assignments, conflicts, days, changedDates }
}

const planA = option(1, [duty('2026-09-01', JANE), duty('2026-09-02', SAM)], [])
const planB = option(2, [duty('2026-09-01', SAM), duty('2026-09-02', JANE)], ['2026-09-01', '2026-09-02'])
const planC = option(3, [duty('2026-09-01', JANE), duty('2026-09-03', SAM)], ['2026-09-02', '2026-09-03'])

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(ScheduleOptionsPage)
  await flushPromises()
  // The progress bar fills to 100% before the options show.
  await vi.advanceTimersByTimeAsync(3_000)
  await flushPromises()
  return wrapper
}

function tabs(wrapper: VueWrapper) {
  return wrapper.findAll('[role="tab"]')
}

// Doctor full names of the calendar slots, in calendar order.
function calendarDoctors(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[role="tabpanel"] span[title]').map((s) => s.attributes('title')!)
    .filter((title) => title === 'Jane Roe' || title === 'Sam Doe')
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  routeRef.route = { query: { year: '2026', month: '9' } }
  options.mockReset()
  generate.mockReset()
  push.mockReset()
  replace.mockReset()
  settle(false)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ScheduleOptionsPage', () => {
  it('renders one tab per option and switching tabs changes the calendar', async () => {
    options.mockResolvedValue({ year: 2026, month: 9, options: [planA, planB, planC] })
    const wrapper = await mountPage()

    expect(options).toHaveBeenCalledWith(2026, 9)
    expect(tabs(wrapper).map((t) => t.text())).toEqual([
      "Plan ASolver's first choice",
      'Plan B2 day(s) differ from Plan A',
      'Plan C2 day(s) differ from Plan A',
    ])
    expect(tabs(wrapper)[0]!.attributes('aria-selected')).toBe('true')
    expect(calendarDoctors(wrapper)).toEqual(['Jane Roe', 'Sam Doe'])
    expect(wrapper.findAll('[data-highlight-marker]')).toHaveLength(0)

    await tabs(wrapper)[1]!.trigger('click')
    expect(tabs(wrapper)[1]!.attributes('aria-selected')).toBe('true')
    expect(tabs(wrapper)[0]!.attributes('aria-selected')).toBe('false')
    expect(calendarDoctors(wrapper)).toEqual(['Sam Doe', 'Jane Roe'])
    expect(wrapper.findAll('[data-highlight-marker]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('different best plan')
  })

  it('"Use Plan B" saves option B after confirmation and opens the new schedule', async () => {
    options.mockResolvedValue({ year: 2026, month: 9, options: [planA, planB, planC] })
    generate.mockResolvedValue({ schedule: { id: 42 } })
    const wrapper = await mountPage()

    await tabs(wrapper)[1]!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Use Plan B')!.trigger('click')
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
    settle(true)
    await flushPromises()

    expect(generate).toHaveBeenCalledWith(2026, 9, [
      { date: '2026-09-01', doctorId: 6, reason: 'solver optimal 2026-09-01' },
      { date: '2026-09-02', doctorId: 5, reason: 'solver optimal 2026-09-02' },
    ])
    expect(push).toHaveBeenCalledWith('/schedules/42')
  })

  it('a cancelled confirmation saves nothing', async () => {
    options.mockResolvedValue({ year: 2026, month: 9, options: [planA] })
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === 'Use Plan A')!.trigger('click')
    await flushPromises()
    settle(false)
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
  })

  it('shows a save error inline and keeps the options', async () => {
    options.mockResolvedValue({ year: 2026, month: 9, options: [planA] })
    generate.mockRejectedValue(new ApiError('Schedule already exists for this month; delete it first', 409))
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === 'Use Plan A')!.trigger('click')
    await flushPromises()
    settle(true)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Schedule already exists')
    expect(tabs(wrapper)).toHaveLength(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('routes to the preview page when option 1 has conflicts', async () => {
    options.mockResolvedValue({
      year: 2026,
      month: 9,
      options: [option(1, [], [], [{ date: '2026-09-03', detail: 'no eligible doctor' }])],
    })
    const wrapper = await mountPage()
    expect(replace).toHaveBeenCalledWith({ path: '/schedules/preview', query: { year: '2026', month: '9' } })
    expect(tabs(wrapper)).toHaveLength(0)
  })

  it('shows a notice when fewer than 3 options exist', async () => {
    options.mockResolvedValue({ year: 2026, month: 9, options: [planA] })
    const wrapper = await mountPage()
    expect(tabs(wrapper)).toHaveLength(1)
    expect(wrapper.text()).toContain('Only 1 different best plan(s) exist for this month.')
  })

  it('shows the 409 error when a schedule already exists', async () => {
    options.mockRejectedValue(new ApiError('Schedule already exists for this month; delete it first', 409))
    const wrapper = await mountPage()
    expect(wrapper.find('[role="alert"]').text()).toContain('Schedule already exists')
    expect(tabs(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('button').some((b) => b.text() === 'Back to schedules')).toBe(true)
  })

  it('shows the invalid month block without requesting options', async () => {
    routeRef.route = { query: { year: 'x', month: '13' } }
    const wrapper = await mountPage()
    expect(options).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Invalid or missing month.')
  })

  it('shows a spinner and a progress bar while the options compute', async () => {
    options.mockReturnValue(new Promise(() => {}))
    const wrapper = mount(ScheduleOptionsPage)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(wrapper.find('[role="status"] svg.animate-spin').exists()).toBe(true)
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('10')
  })
})
