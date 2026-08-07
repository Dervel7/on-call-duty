import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const preview = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

import SchedulesPage from '../pages/SchedulesPage.vue'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 8,
    status: 'draft',
    createdBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  preview.mockReset()
  generate.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulesPage', () => {
  it('renders the list with month label and status', async () => {
    list.mockResolvedValue([summary()])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('August 2026')
    expect(wrapper.text()).toContain('Draft')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('boom'))
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
  })

  it('gates Generate behind a clean preview (disabled while conflicts exist)', async () => {
    list.mockResolvedValue([])
    preview.mockResolvedValue({
      assignments: [],
      conflicts: [{ date: '2026-09-01', detail: '0 doctors' }],
    })
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()

    // Dialog contents render via <Teleport to="body">, so the Preview/Generate
    // buttons live in document.body, outside wrapper's element subtree.
    const buttons = () => ([
      ...wrapper.findAll('button'),
      ...Array.from(document.body.querySelectorAll('button')).map((el) => new DOMWrapper(el)),
    ])
    await buttons().find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()

    const gen = buttons().find((b) => b.text().includes('Generate'))!
    // Disabled before any successful preview (assignments === 0)
    expect((gen.element as HTMLButtonElement).disabled).toBe(true)

    // Run preview -> 1 conflict -> still disabled + conflict text shown
    await buttons().find((b) => b.text().includes('Preview'))!.trigger('click')
    await flushPromises()
    expect(document.body.textContent ?? '').toContain('1 unfillable day')
    expect((gen.element as HTMLButtonElement).disabled).toBe(true)
    expect(preview).toHaveBeenCalled()
  })
})
