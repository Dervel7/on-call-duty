import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const get = vi.fn()
const remove = vi.fn()
const replace = vi.fn()
const publish = vi.fn()
const unpublish = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: vi.fn(),
  generate: vi.fn(),
  get: (...a: unknown[]) => get(...a),
  remove: (...a: unknown[]) => remove(...a),
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn(), replace: (...a: unknown[]) => replace(...a) }),
}))

import ScheduleDetailPage from '../pages/ScheduleDetailPage.vue'
import { ApiError } from '../lib/http'
import { useAuthStore } from '../stores/auth'
import { pickOption } from './pick-option'
import { setTestLocale } from './i18n'
import { useConfirmState } from '../composables/useConfirm'

const { settle } = useConfirmState()
const JANE = { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' }
const SAM = { ...JANE, id: 6, userId: 6, email: 's@b.c', username: 's', firstName: 'Sam', lastName: 'Doe' }

function daysFor(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return {
      date: iso,
      isWeekend: dow === 0 || dow === 6,
      dutyType: 'closed' as const,
      slotsRequired: 2,
      slotsMinimum: 1,
      eligibleDoctorIds: [5],
      availableDoctorIds: [5],
    }
  })
}

function detail(status: 'draft' | 'published') {
  return {
    schedule: {
      id: 1, year: 2026, month: 9, status, createdBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    },
    duties: [
      {
        id: 10, scheduleId: 1, dutyDate: '2026-09-05', doctorId: 5,
        doctorFirstName: 'Jane', doctorLastName: 'Roe',
        isWeekend: false, reason: 'score 1',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    days: daysFor(2026, 9),
  }
}

function mountAs(role: 'administrator' | 'doctor' = 'administrator') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = {
    id: 1, role, email: 'a@b.c', username: 'a', firstName: 'A', lastName: 'B', isActive: true,
  } as never
  auth.accessToken = 'x'
  return mount(ScheduleDetailPage, { global: { plugins: [pinia] } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function buttonByText(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)!
}

beforeEach(() => {
  settle(false)
  remove.mockReset()
  replace.mockReset()
  setActivePinia(createPinia())
  get.mockReset()
  publish.mockReset()
  unpublish.mockReset()
  addDuty.mockReset()
  reassignDuty.mockReset()
  removeDuty.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('ScheduleDetailPage', () => {
  it('renders the calendar with the assigned doctor (admin, draft, editable)', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('[role="combobox"]').length).toBeGreaterThan(0)
  })

  it('locks to read-only when published (no selects)', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.findAll('[role="combobox"]').length).toBe(0)
  })

  it('doctor sees read-only names without loading the doctor list (no selects, no publish buttons)', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('doctor')
    await flushPromises()
    expect(doctorList).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('[role="combobox"]').length).toBe(0)
    expect(wrapper.text()).not.toContain('Revert to draft')
  })

  it('colors day cells by coverage: green full, amber partial, red empty (draft)', async () => {
    const d = detail('draft')
    d.duties.push(
      { id: 11, scheduleId: 1, dutyDate: '2026-09-05', doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', isWeekend: false, reason: 'score 1', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 12, scheduleId: 1, dutyDate: '2026-09-06', doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', isWeekend: false, reason: 'score 1', createdAt: '2026-09-01T00:00:00.000Z' },
    )
    get.mockResolvedValue(d)
    const wrapper = mountAs('administrator')
    await flushPromises()
    // September 2026 starts on a Tuesday: grid cell index = 1 + (day - 1).
    const cls = (day: number) => wrapper.findAll('.grid.grid-cols-7')[1]!.findAll(':scope > div')[day]!.attributes('class')
    expect(cls(1)).toContain('bg-destructive/10')
    expect(cls(5)).toContain('bg-success/10')
    expect(cls(6)).toContain('bg-warning/10')
  })

  it('keeps coverage colors when published and read-only', async () => {
    const d = detail('published')
    d.duties.push(
      { id: 11, scheduleId: 1, dutyDate: '2026-09-05', doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', isWeekend: false, reason: 'score 1', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 12, scheduleId: 1, dutyDate: '2026-09-06', doctorId: 6, doctorFirstName: 'Sam', doctorLastName: 'Doe', isWeekend: false, reason: 'score 1', createdAt: '2026-09-01T00:00:00.000Z' },
    )
    get.mockResolvedValue(d)
    const wrapper = mountAs('doctor')
    await flushPromises()
    const cls = (day: number) => wrapper.findAll('.grid.grid-cols-7')[1]!.findAll(':scope > div')[day]!.attributes('class')
    expect(cls(1)).toContain('bg-destructive/10')
    expect(cls(5)).toContain('bg-success/10')
    expect(cls(6)).toContain('bg-warning/10')
    expect(wrapper.text()).not.toContain('No doctor')
  })

  it('adds a duty via the inline select and reloads', async () => {
    get.mockResolvedValueOnce(detail('draft'))
    addDuty.mockResolvedValue({ id: 99 } as never)
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await pickOption(wrapper.element, '[role="combobox"]', '5')
    await flushPromises()
    expect(addDuty).toHaveBeenCalledWith(1, { date: '2026-09-01', doctorId: 5 })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed duty edit error visible after the reload', async () => {
    get.mockResolvedValue(detail('draft'))
    addDuty.mockRejectedValue(new ApiError('Constraint violation: back-to-back duty', 409))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await pickOption(wrapper.element, '[role="combobox"]', '5')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').text()).toContain('Constraint violation: back-to-back duty')
  })

  it('keeps the day disabled until the reload lands, and shows the newest of out-of-order reloads', async () => {
    const empty = { ...detail('draft'), duties: [] }
    const stale = deferred<unknown>()
    const fresh = deferred<unknown>()
    get.mockResolvedValueOnce(empty).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    addDuty.mockResolvedValue({ id: 99 })
    const wrapper = mountAs('administrator')
    await flushPromises()

    await pickOption(wrapper.element, '[aria-label="2026-09-01 slot 1"]', '5')
    expect(wrapper.find('[aria-label="2026-09-01 slot 1"]').attributes('disabled')).toBeDefined()

    await pickOption(wrapper.element, '[aria-label="2026-09-02 slot 1"]', '5')
    fresh.resolve(detail('draft'))
    await flushPromises()
    stale.resolve(empty)
    await flushPromises()
    expect(wrapper.text()).toContain('Roe J.')
  })

  it('reassigns a duty through the day select', async () => {
    const d = detail('draft')
    d.days.forEach((x) => (x.eligibleDoctorIds = [5, 6]))
    get.mockResolvedValue(d)
    reassignDuty.mockResolvedValue({ id: 10 })
    doctorList.mockResolvedValue([JANE, SAM])
    const wrapper = mountAs('administrator')
    await flushPromises()
    await pickOption(wrapper.element, '[aria-label="2026-09-05 slot 1"]', '6')
    expect(reassignDuty).toHaveBeenCalledWith(10, { doctorId: 6 })
  })

  it('removes a duty after confirmation and keeps the alert when the API rejects', async () => {
    get.mockResolvedValue(detail('draft'))
    removeDuty.mockRejectedValue(new ApiError('Cannot leave an open on-call day empty', 409))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await pickOption(wrapper.element, '[aria-label="2026-09-05 slot 1"]', '')
    expect(removeDuty).not.toHaveBeenCalled()
    settle(true)
    await flushPromises()
    expect(removeDuty).toHaveBeenCalledWith(10)
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').text()).toContain('Cannot leave an open on-call day empty')
  })

  it('does not remove a duty when the confirmation is cancelled', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await pickOption(wrapper.element, '[aria-label="2026-09-05 slot 1"]', '')
    settle(false)
    await flushPromises()
    expect(removeDuty).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('publishes after confirmation and locks the calendar', async () => {
    get.mockResolvedValue(detail('draft'))
    publish.mockResolvedValue({ status: 'published' })
    const wrapper = mountAs('administrator')
    await flushPromises()
    await buttonByText(wrapper, 'Publish').trigger('click')
    settle(true)
    await flushPromises()
    expect(publish).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.findAll('[role="combobox"]').length).toBe(0)
  })

  it('disables Publish while the request is in flight', async () => {
    get.mockResolvedValue(detail('draft'))
    const pending = deferred<{ status: string }>()
    publish.mockReturnValue(pending.promise)
    const wrapper = mountAs('administrator')
    await flushPromises()
    await buttonByText(wrapper, 'Publish').trigger('click')
    settle(true)
    await flushPromises()
    expect(buttonByText(wrapper, 'Publish').attributes('disabled')).toBeDefined()
    pending.resolve({ status: 'published' })
    await flushPromises()
  })

  it('resyncs with the server when publishing hits a 409', async () => {
    get.mockResolvedValueOnce(detail('draft')).mockResolvedValue(detail('published'))
    publish.mockRejectedValue(new ApiError('Schedule is already published', 409))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await buttonByText(wrapper, 'Publish').trigger('click')
    settle(true)
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.find('[role="alert"]').text()).toContain('Schedule is already published')
  })

  it('reverts to draft after confirmation and brings the selects back', async () => {
    get.mockResolvedValue(detail('published'))
    unpublish.mockResolvedValue({ status: 'draft' })
    const wrapper = mountAs('administrator')
    await flushPromises()
    await buttonByText(wrapper, 'Revert to draft').trigger('click')
    settle(true)
    await flushPromises()
    expect(unpublish).toHaveBeenCalledWith(1)
    expect(wrapper.findAll('[role="combobox"]').length).toBeGreaterThan(0)
  })

  it('deletes the schedule after confirmation and replaces the route', async () => {
    get.mockResolvedValue(detail('draft'))
    remove.mockResolvedValue(undefined)
    const wrapper = mountAs('administrator')
    await flushPromises()
    await buttonByText(wrapper, 'Delete schedule').trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(replace).toHaveBeenCalledWith('/schedules')
  })
})

describe('ScheduleDetailPage in Greek', () => {
  it('renders the month, status and admin actions in the active UI language', async () => {
    setTestLocale('el')
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    const month = new Intl.DateTimeFormat('el-GR', { month: 'long', year: 'numeric' }).format(new Date(2026, 8, 1))
    expect(wrapper.text()).toContain(month)
    expect(wrapper.text()).toContain('Δημοσιευμένο')
    expect(wrapper.text()).toContain('Επαναφορά σε πρόχειρο')
    expect(wrapper.text()).toContain('Διαγραφή προγράμματος')
  })
})
