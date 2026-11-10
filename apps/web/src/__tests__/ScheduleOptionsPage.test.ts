import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { AssignmentPlan, DayInfo, ScheduleOption } from '@oncall/shared'
import { ApiError } from '@/lib/http'

const options = vi.fn()
const alternative = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  options: (...a: unknown[]) => options(...a),
  alternative: (...a: unknown[]) => alternative(...a),
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

const mounted: VueWrapper[] = []

/** The first response: option A only; B and C are computed when their tab opens. */
function primary(overrides: Record<string, unknown> = {}) {
  return { year: 2026, month: 9, options: [planA], maxOptions: 3, moreAvailable: true, ...overrides }
}

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(ScheduleOptionsPage, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  // The progress bar fills to 100% before the options show.
  await vi.advanceTimersByTimeAsync(6_000)
  await flushPromises()
  return wrapper
}

function tabs(wrapper: VueWrapper) {
  return wrapper.findAll('[role="tab"]')
}

/** Opens a tab and lets the alternative request and its progress bar finish. */
async function openTab(wrapper: VueWrapper, i: number): Promise<void> {
  await tabs(wrapper)[i]!.trigger('click')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(6_000)
  await flushPromises()
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
  alternative.mockReset()
  generate.mockReset()
  push.mockReset()
  replace.mockReset()
  settle(false)
})
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ScheduleOptionsPage', () => {
  it('computes only option A at first; B and C wait for their tab', async () => {
    options.mockResolvedValue(primary())
    const wrapper = await mountPage()

    expect(options).toHaveBeenCalledWith(2026, 9)
    expect(alternative).not.toHaveBeenCalled()
    expect(tabs(wrapper).map((t) => t.text())).toEqual([
      "Plan ASolver's first choice",
      'Plan BOpen to compute',
      'Plan COpen to compute',
    ])
    expect(tabs(wrapper)[2]!.attributes('disabled')).toBeDefined()
    expect(calendarDoctors(wrapper)).toEqual(['Jane Roe', 'Sam Doe'])
  })

  it('opening tab B asks for index 2 and shows the plan; C then opens with index 3', async () => {
    options.mockResolvedValue(primary())
    alternative
      .mockResolvedValueOnce({ option: planB, moreAvailable: true })
      .mockResolvedValueOnce({ option: planC, moreAvailable: false })
    const wrapper = await mountPage()

    await openTab(wrapper, 1)
    expect(alternative).toHaveBeenLastCalledWith(2026, 9, 2)
    expect(tabs(wrapper)[1]!.attributes('aria-selected')).toBe('true')
    expect(tabs(wrapper)[1]!.text()).toBe('Plan B2 day(s) differ from Plan A')
    expect(calendarDoctors(wrapper)).toEqual(['Sam Doe', 'Jane Roe'])
    expect(wrapper.text()).not.toContain('different best plan')

    await openTab(wrapper, 2)
    expect(alternative).toHaveBeenLastCalledWith(2026, 9, 3)
    expect(tabs(wrapper)[2]!.text()).toBe('Plan C2 day(s) differ from Plan A')

    // A computed plan is shown again without another request.
    await tabs(wrapper)[1]!.trigger('click')
    expect(alternative).toHaveBeenCalledTimes(2)
    expect(calendarDoctors(wrapper)).toEqual(['Sam Doe', 'Jane Roe'])
  })

  it('disables the empty tabs while an alternative is computing', async () => {
    options.mockResolvedValue(primary())
    alternative.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPage()

    await tabs(wrapper)[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
    expect(tabs(wrapper)[1]!.attributes('disabled')).toBeDefined()
    expect(tabs(wrapper)[2]!.attributes('disabled')).toBeDefined()
    expect(tabs(wrapper)[0]!.attributes('disabled')).toBeUndefined()
  })

  it('"Use Plan B" saves option B after confirmation and opens the new schedule', async () => {
    options.mockResolvedValue(primary())
    alternative.mockResolvedValue({ option: planB, moreAvailable: true })
    generate.mockResolvedValue({ schedule: { id: 42 } })
    const wrapper = await mountPage()

    await openTab(wrapper, 1)
    await wrapper.findAll('button').find((b) => b.text() === 'Use Plan B')!.trigger('click')
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
    settle(true)
    await flushPromises()

    expect(generate).toHaveBeenCalledWith(2026, 9, [
      { date: '2026-09-01', doctorId: 6, reason: 'solver optimal 2026-09-01' },
      { date: '2026-09-02', doctorId: 5, reason: 'solver optimal 2026-09-02' },
    ])
    expect(replace).toHaveBeenCalledWith('/schedules/42')
  })

  it('moves focus between tabs with the arrow keys without computing anything', async () => {
    options.mockResolvedValue(primary())
    const wrapper = await mountPage()
    expect(tabs(wrapper).map((t) => t.attributes('tabindex'))).toEqual(['0', '-1', '-1'])

    await tabs(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(document.activeElement).toBe(tabs(wrapper)[1]!.element)
    expect(alternative).not.toHaveBeenCalled()
  })

  it('a cancelled confirmation saves nothing', async () => {
    options.mockResolvedValue(primary({ moreAvailable: false }))
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === 'Use Plan A')!.trigger('click')
    await flushPromises()
    settle(false)
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
  })

  it('shows a save error inline and keeps the options', async () => {
    options.mockResolvedValue(primary({ moreAvailable: false }))
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

  it('shows every option when all are understaffed and blocks using them', async () => {
    const short: ScheduleOption['conflicts'] = [
      {
        date: '2026-09-03',
        critical: true,
        required: 3,
        assigned: 2,
        activeDoctors: 2,
        tally: { unavailable: 0, atMonthlyCap: 0, atOpenDutyCap: 0, atHolidayCap: 0, backToBack: 0, alreadyOnDuty: 2 },
      },
    ]
    options.mockResolvedValue(primary({ options: [option(1, planA.assignments, [], short)] }))
    alternative.mockResolvedValue({
      option: option(2, planB.assignments, planB.changedDates, short),
      moreAvailable: true,
    })
    const wrapper = await mountPage()

    expect(replace).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('1 day(s) are below their minimum on-call doctors in every plan')
    expect(wrapper.text()).toContain('2026-09-03: requires 3 doctors (open on-call rule)')
    const use = () => wrapper.findAll('button').find((b) => b.text().startsWith('Use Plan'))!
    expect(use().attributes('disabled')).toBeDefined()

    await openTab(wrapper, 1)
    expect(use().text()).toBe('Use Plan B')
    expect(use().attributes('disabled')).toBeDefined()
    await use().trigger('click')
    await flushPromises()
    expect(generate).not.toHaveBeenCalled()
  })

  it('shows only tab A and a notice when no equally good plan can exist', async () => {
    options.mockResolvedValue(primary({ moreAvailable: false }))
    const wrapper = await mountPage()
    expect(tabs(wrapper)).toHaveLength(1)
    expect(wrapper.text()).toContain('Only 1 different best plan(s) exist for this month.')
  })

  it('marks the tab when no other equally good plan exists and disables the later tabs', async () => {
    options.mockResolvedValue(primary())
    alternative.mockResolvedValue({ option: null, moreAvailable: false })
    const wrapper = await mountPage()

    await openTab(wrapper, 1)
    expect(tabs(wrapper)[1]!.text()).toBe('Plan BNo other equally good plan')
    expect(tabs(wrapper)[1]!.attributes('disabled')).toBeDefined()
    expect(tabs(wrapper)[2]!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Only 1 different best plan(s) exist for this month.')
  })

  it('shows the busy message with a retry that asks again', async () => {
    options.mockResolvedValue(primary())
    alternative
      .mockRejectedValueOnce(new ApiError('Solver busy, try again shortly', 429))
      .mockResolvedValueOnce({ option: planB, moreAvailable: true })
    const wrapper = await mountPage()

    await openTab(wrapper, 1)
    expect(wrapper.find('[role="alert"]').text()).toContain('Solver busy, try again shortly')
    await wrapper.findAll('button').find((b) => b.text() === 'Try again')!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(6_000)
    await flushPromises()
    expect(alternative).toHaveBeenCalledTimes(2)
    expect(tabs(wrapper)[1]!.text()).toContain('2 day(s) differ')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('reloads option A when the options expired on the server', async () => {
    options.mockResolvedValue(primary())
    alternative.mockRejectedValue(new ApiError('Options expired, generate them again', 404))
    const wrapper = await mountPage()

    await openTab(wrapper, 1)
    await vi.advanceTimersByTimeAsync(6_000)
    await flushPromises()
    expect(options).toHaveBeenCalledTimes(2)
    expect(tabs(wrapper)[0]!.attributes('aria-selected')).toBe('true')
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
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('8')
  })
})
