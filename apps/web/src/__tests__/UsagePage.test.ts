import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { GeneratePressCounts, GenerationEvent, OperatorAlert, UsageSummary } from '@oncall/shared'

const summary = vi.fn()
const generations = vi.fn()
const alerts = vi.fn()
const resolveAlert = vi.fn()
const generatePresses = vi.fn()
vi.mock('@/services/usage', () => ({
  summary: (...a: unknown[]) => summary(...a),
  generations: (...a: unknown[]) => generations(...a),
  alerts: (...a: unknown[]) => alerts(...a),
  resolveAlert: (...a: unknown[]) => resolveAlert(...a),
  generatePresses: (...a: unknown[]) => generatePresses(...a),
}))

import UsagePage from '../pages/UsagePage.vue'

const summaryFixture: UsageSummary = {
  license: {
    licensee: 'General Hospital',
    doctorAllowance: 25,
    rollingWindowDays: 90,
    expiresAt: null,
  },
  rollingDistinctDoctors: 12,
  openAlerts: 1,
}

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
    type: 'allowance_exceeded',
    detail: { rollingDistinctDoctors: 12, doctorAllowance: 25 },
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

const pressesFixture: GeneratePressCounts = {
  total: 23,
  byUser: [{ userId: 2, username: 'admin1', firstName: 'Ada', lastName: 'Lovelace', presses: 23 }],
}

function mockResolved() {
  summary.mockResolvedValue(summaryFixture)
  generations.mockResolvedValue(generationsFixture)
  alerts.mockResolvedValue(alertsFixture)
  generatePresses.mockResolvedValue(pressesFixture)
}

beforeEach(() => {
  setActivePinia(createPinia())
  summary.mockReset()
  generations.mockReset()
  alerts.mockReset()
  resolveAlert.mockReset()
  generatePresses.mockReset()
})
afterEach(() => vi.restoreAllMocks())

async function mountPage() {
  mockResolved()
  const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

describe('UsagePage', () => {
  it('renders license numbers, generations, and alerts on mount', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('General Hospital')
    expect(wrapper.text()).toContain('12 / 25')
    expect(wrapper.text()).toContain('90 days')
    expect(wrapper.text()).toContain('2026-08')
    expect(wrapper.text()).toContain('Jane Roe, John Doe')
    expect(wrapper.text()).toContain('50%')
    expect(wrapper.text()).toContain('allowance_exceeded')
    expect(wrapper.text()).toContain('disjoint_regeneration')
    expect(wrapper.text()).toContain('Generate button presses')
    expect(wrapper.text()).toContain('Ada Lovelace (admin1)')
    expect(wrapper.text()).toContain('23')
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
    expect(summary).toHaveBeenCalledTimes(1)
  })

  it('shows an error message when loading fails', async () => {
    summary.mockRejectedValue(new Error('nope'))
    generations.mockResolvedValue([])
    alerts.mockResolvedValue([])
    generatePresses.mockResolvedValue({ total: 0, byUser: [] })
    const wrapper = mount(UsagePage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
