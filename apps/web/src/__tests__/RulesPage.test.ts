import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const getOpenDuty = vi.fn()
const updateOpenDutyInterval = vi.fn()
const getDutySlots = vi.fn()
const updateDutySlots = vi.fn()
const getDutyMinimums = vi.fn()
const updateDutyMinimums = vi.fn()
vi.mock('@/services/settings', () => ({
  getOpenDuty: (...a: unknown[]) => getOpenDuty(...a),
  updateOpenDutyInterval: (...a: unknown[]) => updateOpenDutyInterval(...a),
  getDutySlots: (...a: unknown[]) => getDutySlots(...a),
  updateDutySlots: (...a: unknown[]) => updateDutySlots(...a),
  getDutyMinimums: (...a: unknown[]) => getDutyMinimums(...a),
  updateDutyMinimums: (...a: unknown[]) => updateDutyMinimums(...a),
}))

import RulesPage from '../pages/RulesPage.vue'

const adminAuth = () => ({
  id: 2,
  email: 'admin@h.com',
  username: 'admin',
  role: 'administrator' as const,
  firstName: 'Ada',
  lastName: 'Admin',
  darkMode: false,
  clinicId: 1,
  clinicName: 'Main Clinic',
})

async function mountRules() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = adminAuth()
  getOpenDuty.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 8 })
  getDutySlots.mockResolvedValue({ openDutySlots: 4, closedDutySlots: 2 })
  getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, closedDutyMinimum: 1 })
  const wrapper = mount(RulesPage, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getOpenDuty.mockReset()
  updateOpenDutyInterval.mockReset()
  getDutySlots.mockReset()
  updateDutySlots.mockReset()
  getDutyMinimums.mockReset()
  updateDutyMinimums.mockReset()
})

describe('RulesPage', () => {
  it('loads and shows every dynamic rule with its current value', async () => {
    const wrapper = await mountRules()
    expect(getOpenDuty).toHaveBeenCalled()
    expect(getDutySlots).toHaveBeenCalled()
    expect(getDutyMinimums).toHaveBeenCalled()
    expect(wrapper.text()).toContain('On-call duty cycle')
    expect(wrapper.text()).toContain('On-call slots')
    expect(wrapper.text()).toContain('Minimum on-call doctors')
    expect(wrapper.text()).toContain('2026-10-02')
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).value).toBe('8')
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('4')
    expect((wrapper.find('#closed-duty-slots').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.find('#closed-duty-minimum').element as HTMLInputElement).value).toBe('1')
  })

  it('saves a new interval through the service and confirms', async () => {
    updateOpenDutyInterval.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 14 })
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-interval').setValue('14')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateOpenDutyInterval).toHaveBeenCalledWith(14)
    expect(form.find('[role="status"]').text()).toContain('Interval updated.')
    expect(form.find('[role="alert"]').exists()).toBe(false)
  })

  it('rejects an invalid interval without calling the service', async () => {
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-interval').setValue('0')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateOpenDutyInterval).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').exists()).toBe(true)
  })

  it('saves new slot counts through the service and confirms', async () => {
    updateDutySlots.mockResolvedValue({ openDutySlots: 3, closedDutySlots: 1 })
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-slots').setValue('3')
    await wrapper.find('#closed-duty-slots').setValue('1')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-slots').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutySlots).toHaveBeenCalledWith(3, 1)
    expect(form.find('[role="status"]').text()).toContain('Slots updated.')
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('3')
    expect((wrapper.find('#closed-duty-slots').element as HTMLInputElement).value).toBe('1')
  })

  it('rejects out-of-range slot counts without calling the service', async () => {
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-slots').setValue('8')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-slots').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutySlots).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').exists()).toBe(true)
  })

  it('saves new minimums through the service and confirms', async () => {
    updateDutyMinimums.mockResolvedValue({ openDutyMinimum: 3, closedDutyMinimum: 2 })
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-minimum').setValue('3')
    await wrapper.find('#closed-duty-minimum').setValue('2')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-minimum').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutyMinimums).toHaveBeenCalledWith(3, 2)
    expect(form.find('[role="status"]').text()).toContain('Minimums updated.')
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('3')
    expect((wrapper.find('#closed-duty-minimum').element as HTMLInputElement).value).toBe('2')
  })

  it('rejects out-of-range minimums without calling the service', async () => {
    const wrapper = await mountRules()
    await wrapper.find('#closed-duty-minimum').setValue('0')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-minimum').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutyMinimums).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').exists()).toBe(true)
  })

  it('shows a server rejection in the minimums card only', async () => {
    updateDutyMinimums.mockRejectedValue(new Error('Open minimum cannot exceed the open slot count (4)'))
    const wrapper = await mountRules()
    await wrapper.find('#open-duty-minimum').setValue('5')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-minimum').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutyMinimums).toHaveBeenCalledWith(5, 1)
    expect(form.find('[role="alert"]').text()).toContain('cannot exceed the open slot count')
    expect(form.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  })

  it('disables inputs and buttons until settings have loaded', async () => {
    setActivePinia(createPinia())
    let resolveCycle!: (value: unknown) => void
    getOpenDuty.mockReturnValue(new Promise((resolve) => (resolveCycle = resolve)))
    getDutySlots.mockResolvedValue({ openDutySlots: 2, closedDutySlots: 2 })
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, closedDutyMinimum: 2 })
    const wrapper = mount(RulesPage)
    await flushPromises()
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.findAll('button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
    resolveCycle({ anchorDate: '2026-10-02', intervalDays: 8 })
    await flushPromises()
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).disabled).toBe(false)
    expect(wrapper.findAll('button').every((b) => !(b.element as HTMLButtonElement).disabled)).toBe(true)
  })

  it('keeps the slots card populated when only the interval fails to load', async () => {
    getOpenDuty.mockRejectedValue(new Error('cycle down'))
    getDutySlots.mockResolvedValue({ openDutySlots: 3, closedDutySlots: 1 })
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, closedDutyMinimum: 1 })
    const wrapper = mount(RulesPage)
    await flushPromises()
    const intervalForm = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    const slotsForm = wrapper.findAll('form').find((f) => f.find('#open-duty-slots').exists())!
    expect(intervalForm.find('[role="alert"]').text()).toContain('cycle down')
    expect(slotsForm.find('[role="alert"]').exists()).toBe(false)
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('3')
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('2')
  })
})
