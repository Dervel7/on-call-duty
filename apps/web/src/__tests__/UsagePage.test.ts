import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { GenerationEvent, OperatorAlert } from '@oncall/shared'

const generations = vi.fn()
const alerts = vi.fn()
const billingState = vi.fn()
const billingUpdate = vi.fn()
const resolveAlert = vi.fn()
vi.mock('@/services/usage', () => ({
  generations: (...a: unknown[]) => generations(...a),
  alerts: (...a: unknown[]) => alerts(...a),
  resolveAlert: (...a: unknown[]) => resolveAlert(...a),
}))
vi.mock('@/services/billing', () => ({
  state: (...a: unknown[]) => billingState(...a),
  update: (...a: unknown[]) => billingUpdate(...a),
}))

import UsagePage from '../pages/UsagePage.vue'

const generationsFixture: GenerationEvent[] = [
  {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-01T07:00:00.000Z',
    doctorIds: [1, 2],
    doctorNames: ['Jane Roe', 'John Doe'],
    overlapPercent: 50,
  },
]

const alertsFixture: OperatorAlert[] = [
  {
    id: 1,
    type: 'disjoint_regeneration',
    detail: { overlapPercent: 40 },
    createdAt: '2026-08-02T07:00:00.000Z',
    resolvedAt: '2026-08-03T07:00:00.000Z',
  },
  {
    id: 2,
    type: 'disjoint_regeneration',
    detail: { overlapPercent: 0 },
    createdAt: '2026-08-04T07:00:00.000Z',
    resolvedAt: null,
  },
]

function mockResolved() {
  generations.mockResolvedValue(generationsFixture)
  alerts.mockResolvedValue(alertsFixture)
  billingState.mockResolvedValue({ paidThrough: '2026-12-31', locked: false })
}

beforeEach(() => {
  setActivePinia(createPinia())
  generations.mockReset()
  alerts.mockReset()
  resolveAlert.mockReset()
  billingState.mockReset()
  billingUpdate.mockReset()
})
afterEach(() => vi.restoreAllMocks())

async function mountPage() {
  mockResolved()
  const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

describe('UsagePage', () => {
  it('renders the locally computed open-alert count, generations, and alerts on mount', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Open alerts: 1')
    expect(wrapper.text()).toContain('2026-08')
    expect(wrapper.text()).toContain('Jane Roe, John Doe')
    expect(wrapper.text()).toContain('50%')
    expect(wrapper.text()).toContain('disjoint_regeneration')
    expect(wrapper.text()).not.toContain('License')
  })

  it('shows an enabled Resolve button for open alerts and calls resolveAlert on click', async () => {
    resolveAlert.mockResolvedValue(alertsFixture[1])
    const wrapper = await mountPage()
    const buttons = wrapper.findAll('button').filter((b) => b.text() === 'Resolve')
    const openBtn = buttons.find((b) => !(b.element as HTMLButtonElement).disabled)
    const resolvedBtn = buttons.find((b) => (b.element as HTMLButtonElement).disabled)
    expect(buttons).toHaveLength(2)
    expect(openBtn).toBeDefined()
    expect(resolvedBtn).toBeDefined()
    await openBtn!.trigger('click')
    await flushPromises()
    expect(resolveAlert).toHaveBeenCalledWith(2)
  })

  it('shows a page-level error and does not reload when resolveAlert fails', async () => {
    resolveAlert.mockRejectedValue(new Error('resolve failed'))
    const wrapper = await mountPage()
    const openBtn = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Resolve')
      .find((b) => !(b.element as HTMLButtonElement).disabled)
    await openBtn!.trigger('click')
    await flushPromises()
    expect(resolveAlert).toHaveBeenCalledWith(2)
    expect(wrapper.find('[role="alert"]').text()).toContain('resolve failed')
    expect(generations).toHaveBeenCalledTimes(1)
  })

  it('shows an error message when loading fails', async () => {
    generations.mockRejectedValue(new Error('nope'))
    alerts.mockResolvedValue([])
    billingState.mockResolvedValue({ paidThrough: null, locked: false })
    const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('renders the billing card with paid-through date and an Active badge', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('Billing')
    expect(wrapper.text()).toContain('Paid through:')
    expect(wrapper.text()).toContain('2026-12-31')
    expect(wrapper.text()).toContain('Active')
    expect(wrapper.text()).not.toContain('Locked')
  })

  it('shows Not set and a Locked badge when billing is locked without a date', async () => {
    mockResolved()
    billingState.mockResolvedValue({ paidThrough: null, locked: true })
    const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Not set')
    expect(wrapper.text()).toContain('Locked')
  })

  it('prefills the date input and calls update on Save, refreshing the displayed state', async () => {
    const wrapper = await mountPage()
    const input = wrapper.find('#billing-date')
    expect((input.element as HTMLInputElement).value).toBe('2026-12-31')
    await input.setValue('2027-06-30')
    billingUpdate.mockResolvedValue({ paidThrough: '2027-06-30', locked: false })
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(billingUpdate).toHaveBeenCalledWith('2027-06-30')
    expect(wrapper.text()).toContain('2027-06-30')
  })

  it('shows an inline billing error when save fails', async () => {
    const wrapper = await mountPage()
    billingUpdate.mockRejectedValue(new Error('save denied'))
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(billingUpdate).toHaveBeenCalledWith('2026-12-31')
    expect(wrapper.find('[role="alert"]').text()).toContain('save denied')
  })
})
