import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { setTestLocale } from './i18n'

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
  language: 'en' as const,
  clinicId: 1,
  clinicName: 'Main Clinic',
})

async function mountRules() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = adminAuth()
  getOpenDuty.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 8 })
  getDutySlots.mockResolvedValue({
    openDutySlots: 4,
    postOpenDutySlots: 3,
    closedDutySlots: 2,
    activeDoctors: 30,
  })
  getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 1 })
  const wrapper = mount(RulesPage, { global: { plugins: [pinia] } })
  await flushPromises()
  return wrapper
}

async function expand(wrapper: VueWrapper, rule: 'cycle' | 'slots' | 'minimums') {
  await wrapper.find(`#rule-${rule}-toggle`).trigger('click')
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
  it('lists every rule title with its current value and keeps the forms collapsed', async () => {
    const wrapper = await mountRules()
    expect(getOpenDuty).toHaveBeenCalled()
    expect(getDutySlots).toHaveBeenCalledWith(1)
    expect(getDutyMinimums).toHaveBeenCalledWith(1)
    expect(wrapper.find('#rule-cycle-toggle').text()).toContain('On-call duty cycle')
    expect(wrapper.find('#rule-cycle-toggle').text()).toContain('Every 8 days')
    expect(wrapper.find('#rule-slots-toggle').text()).toContain('On-call slots')
    expect(wrapper.find('#rule-slots-toggle').text()).toContain('Open 4 · Day after 3 · Closed 2')
    expect(wrapper.find('#rule-minimums-toggle').text()).toContain('Minimum on-call doctors')
    expect(wrapper.find('#rule-minimums-toggle').text()).toContain('Open 2 · Day after 2 · Closed 1')
    expect(wrapper.findAll('form')).toHaveLength(0)
  })

  it('opens one rule at a time with its current values', async () => {
    const wrapper = await mountRules()
    await expand(wrapper, 'cycle')
    expect(wrapper.find('#rule-cycle-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('2026-10-02')
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).value).toBe('8')

    await expand(wrapper, 'slots')
    expect(wrapper.find('#open-duty-interval').exists()).toBe(false)
    expect(wrapper.find('label[for="open-duty-slots"]').text()).toBe('Open on-call days (1–30)')
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('4')
    expect((wrapper.find('#post-open-duty-slots').element as HTMLInputElement).value).toBe('3')
    expect((wrapper.find('#closed-duty-slots').element as HTMLInputElement).value).toBe('2')

    await expand(wrapper, 'minimums')
    expect(wrapper.find('#open-duty-slots').exists()).toBe(false)
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.find('#post-open-duty-minimum').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.find('#closed-duty-minimum').element as HTMLInputElement).value).toBe('1')

    await expand(wrapper, 'minimums')
    expect(wrapper.findAll('form')).toHaveLength(0)
  })

  it('saves a new interval through the service and confirms', async () => {
    updateOpenDutyInterval.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 14 })
    const wrapper = await mountRules()
    await expand(wrapper, 'cycle')
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
    await expand(wrapper, 'cycle')
    await wrapper.find('#open-duty-interval').setValue('0')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateOpenDutyInterval).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').exists()).toBe(true)
  })

  it('saves slot counts above 7 when the clinic has enough doctors', async () => {
    updateDutySlots.mockResolvedValue({
      openDutySlots: 10,
      postOpenDutySlots: 9,
      closedDutySlots: 8,
      activeDoctors: 30,
    })
    const wrapper = await mountRules()
    await expand(wrapper, 'slots')
    await wrapper.find('#open-duty-slots').setValue('10')
    await wrapper.find('#post-open-duty-slots').setValue('9')
    await wrapper.find('#closed-duty-slots').setValue('8')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-slots').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutySlots).toHaveBeenCalledWith(10, 9, 8, 1)
    expect(form.find('[role="status"]').text()).toContain('Slots updated.')
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('10')
    expect((wrapper.find('#post-open-duty-slots').element as HTMLInputElement).value).toBe('9')
    expect((wrapper.find('#closed-duty-slots').element as HTMLInputElement).value).toBe('8')
  })

  it('rejects slot counts above the clinic doctor count without calling the service', async () => {
    const wrapper = await mountRules()
    await expand(wrapper, 'slots')
    await wrapper.find('#post-open-duty-slots').setValue('31')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-slots').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutySlots).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').text()).toContain('30 active doctors')
  })

  it('saves new minimums through the service and confirms', async () => {
    updateDutyMinimums.mockResolvedValue({ openDutyMinimum: 3, postOpenDutyMinimum: 1, closedDutyMinimum: 2 })
    const wrapper = await mountRules()
    await expand(wrapper, 'minimums')
    await wrapper.find('#open-duty-minimum').setValue('3')
    await wrapper.find('#post-open-duty-minimum').setValue('1')
    await wrapper.find('#closed-duty-minimum').setValue('2')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-minimum').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutyMinimums).toHaveBeenCalledWith(3, 1, 2, 1)
    expect(form.find('[role="status"]').text()).toContain('Minimums updated.')
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('3')
    expect((wrapper.find('#post-open-duty-minimum').element as HTMLInputElement).value).toBe('1')
    expect((wrapper.find('#closed-duty-minimum').element as HTMLInputElement).value).toBe('2')
  })

  it('rejects out-of-range minimums without calling the service', async () => {
    const wrapper = await mountRules()
    await expand(wrapper, 'minimums')
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
    await expand(wrapper, 'minimums')
    await wrapper.find('#open-duty-minimum').setValue('5')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-minimum').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateDutyMinimums).toHaveBeenCalledWith(5, 2, 1, 1)
    expect(form.find('[role="alert"]').text()).toContain('cannot exceed the open slot count')
    expect(form.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  })

  it('disables the open rule form until settings have loaded', async () => {
    setActivePinia(createPinia())
    let resolveCycle!: (value: unknown) => void
    getOpenDuty.mockReturnValue(new Promise((resolve) => (resolveCycle = resolve)))
    getDutySlots.mockResolvedValue({
      openDutySlots: 2,
      postOpenDutySlots: 2,
      closedDutySlots: 2,
      activeDoctors: 30,
    })
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 2 })
    const wrapper = mount(RulesPage)
    await flushPromises()
    await expand(wrapper, 'cycle')
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).disabled).toBe(true)
    expect((wrapper.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true)
    resolveCycle({ anchorDate: '2026-10-02', intervalDays: 8 })
    await flushPromises()
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).disabled).toBe(false)
    expect((wrapper.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('flags only the rule that failed to load and keeps the others populated', async () => {
    getOpenDuty.mockRejectedValue(new Error('cycle down'))
    getDutySlots.mockResolvedValue({
      openDutySlots: 3,
      postOpenDutySlots: 2,
      closedDutySlots: 1,
      activeDoctors: 30,
    })
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 1 })
    const wrapper = mount(RulesPage)
    await flushPromises()
    expect(wrapper.find('#rule-cycle-toggle').text()).toContain('Error')
    expect(wrapper.find('#rule-slots-toggle').text()).toContain('Open 3 · Day after 2 · Closed 1')
    await expand(wrapper, 'cycle')
    expect(wrapper.find('[role="alert"]').text()).toContain('cycle down')
    await expand(wrapper, 'slots')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect((wrapper.find('#open-duty-slots').element as HTMLInputElement).value).toBe('3')
    await expand(wrapper, 'minimums')
    expect((wrapper.find('#open-duty-minimum').element as HTMLInputElement).value).toBe('2')
  })
})

describe('RulesPage in Greek', () => {
  it('renders rule titles, summaries and form labels in the active UI language', async () => {
    setTestLocale('el')
    const wrapper = await mountRules()
    expect(wrapper.text()).toContain('Κανόνες')
    expect(wrapper.find('#rule-cycle-toggle').text()).toContain('Κύκλος εφημεριών')
    expect(wrapper.find('#rule-cycle-toggle').text()).toContain('Κάθε 8 ημέρες')
    expect(wrapper.find('#rule-slots-toggle').text()).toContain('Ανοιχτές 4 · Επόμενη 3 · Κλειστές 2')
    await expand(wrapper, 'slots')
    expect(wrapper.find('label[for="open-duty-slots"]').text()).toBe('Ημέρες ανοιχτής εφημερίας (1–30)')
    expect(wrapper.find('label[for="post-open-duty-slots"]').text()).toBe(
      'Επόμενη ημέρα ανοιχτής εφημερίας (1–30)',
    )
    expect(wrapper.find('button[type="submit"]').text()).toBe('Αποθήκευση θέσεων')
  })
})
