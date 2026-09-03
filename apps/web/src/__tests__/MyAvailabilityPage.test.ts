import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listMine = vi.fn()
const createMine = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: vi.fn(),
  listMine: (...a: unknown[]) => listMine(...a),
  createForDoctor: vi.fn(),
  createMine: (...a: unknown[]) => createMine(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import MyAvailabilityPage from '../pages/MyAvailabilityPage.vue'
import { useConfirmState } from '../composables/useConfirm'

const { settle } = useConfirmState()

const record = {
  id: 1,
  doctorId: 5,
  doctorFirstName: 'Jane',
  doctorLastName: 'Roe',
  type: 'sick',
  startDate: '2026-09-15',
  endDate: '2026-09-15',
  note: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  listMine.mockReset()
  createMine.mockReset()
  update.mockReset()
  remove.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

function bodyButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  )
}

function setBodyValue(selector: string, value: string) {
  const el = document.body.querySelector(selector) as HTMLSelectElement | HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'))
}

describe('MyAvailabilityPage', () => {
  it('renders own records on mount', async () => {
    listMine.mockResolvedValue([record])
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('sick')
    expect(wrapper.text()).toContain('2026-09-15')
  })

  it('shows an error when listing fails', async () => {
    listMine.mockRejectedValue(new Error('nope'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('keeps the dialog open with an inline error when create fails', async () => {
    listMine.mockResolvedValue([])
    createMine.mockRejectedValue(new Error('create failed'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New exclusion')!.trigger('click')
    await flushPromises()
    setBodyValue('#m-start', '2026-09-15')
    setBodyValue('#m-end', '2026-09-17')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createMine).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vacation', startDate: '2026-09-15' }),
    )
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('create failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when update fails', async () => {
    listMine.mockResolvedValue([record])
    update.mockRejectedValue(new Error('update failed'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, expect.anything())
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('update failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a page-level error when a confirmed delete fails', async () => {
    listMine.mockResolvedValue([record])
    remove.mockRejectedValue(new Error('delete failed'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(wrapper.find('[role="alert"]').text()).toContain('delete failed')
  })
})
