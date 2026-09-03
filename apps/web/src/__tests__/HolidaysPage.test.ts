import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const remove = vi.fn()
vi.mock('@/services/holiday', () => ({
  list: (...a: unknown[]) => list(...a),
  create: (...a: unknown[]) => create(...a),
  update: vi.fn(),
  remove: (...a: unknown[]) => remove(...a),
}))

import HolidaysPage from '../pages/HolidaysPage.vue'
import { useConfirmState } from '../composables/useConfirm'

const { settle } = useConfirmState()

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
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
  const el = document.body.querySelector(selector) as HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event('input'))
}

describe('HolidaysPage', () => {
  it('renders the list on mount', async () => {
    list.mockResolvedValue([
      { id: 1, name: 'Sample Holiday', date: '2026-09-01', createdAt: '', updatedAt: '' },
    ])
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Sample Holiday')
    expect(wrapper.text()).toContain('2026-09-01')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('keeps the dialog open with an inline error when save fails', async () => {
    list.mockResolvedValue([])
    create.mockRejectedValue(new Error('save failed'))
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New holiday')!.trigger('click')
    await flushPromises()
    setBodyValue('#e-name', 'Christmas')
    setBodyValue('#e-date', '2026-12-25')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ name: 'Christmas', date: '2026-12-25' })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('save failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(list).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('shows a page-level error when a confirmed delete fails', async () => {
    list.mockResolvedValue([
      { id: 1, name: 'Sample Holiday', date: '2026-09-01', createdAt: '', updatedAt: '' },
    ])
    remove.mockRejectedValue(new Error('delete failed'))
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(wrapper.find('[role="alert"]').text()).toContain('delete failed')
    expect(list).toHaveBeenCalledTimes(1)
  })
})
