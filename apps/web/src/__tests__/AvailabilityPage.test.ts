import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listAll = vi.fn()
const createForDoctor = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: (...a: unknown[]) => listAll(...a),
  listMine: vi.fn(),
  createForDoctor: (...a: unknown[]) => createForDoctor(...a),
  createMine: vi.fn(),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import AvailabilityPage from '../pages/AvailabilityPage.vue'
import { useConfirmState } from '../composables/useConfirm'
import { pickOption } from './pick-option'
import { pickDays } from './pick-days'

const { settle } = useConfirmState()

const doctor = {
  id: 5,
  userId: 10,
  email: 'dr@h.com',
  username: 'dr1',
  firstName: 'Jane',
  lastName: 'Roe',
  isActive: true,
  maxMonthlyDuties: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const record = {
  id: 1,
  doctorId: 5,
  doctorFirstName: 'Jane',
  doctorLastName: 'Roe',
  startDate: '2026-09-07',
  endDate: '2026-09-11',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  listAll.mockReset()
  doctorList.mockReset()
  createForDoctor.mockReset()
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

async function openCreateDialog() {
  const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  await wrapper.findAll('button').find((b) => b.text() === 'New exclusion')!.trigger('click')
  await flushPromises()
  return wrapper
}

describe('AvailabilityPage', () => {
  it('renders one line per doctor and expands it into a button per excluded day', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([
      { ...record, startDate: '2026-10-01', endDate: '2026-10-03' },
      { ...record, id: 2, startDate: '2026-10-17', endDate: '2026-10-17' },
      { ...record, id: 3, startDate: '2026-10-22', endDate: '2026-10-23' },
    ])
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Jane Roe')
    expect(wrapper.text()).not.toContain('2026-10-01')
    await wrapper.findAll('button').find((b) => b.text().includes('Jane Roe'))!.trigger('click')
    const days = wrapper
      .findAll('button')
      .filter((b) => b.text().startsWith('2026-10-'))
      .map((b) => b.text())
    expect(days).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-17',
      '2026-10-22',
      '2026-10-23',
    ])
    wrapper.unmount()
  })

  it('shows an error when listing fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockRejectedValue(new Error('nope'))
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('keeps the dialog open with an inline error when create fails', async () => {
    doctorList.mockResolvedValue([doctor])
    listAll.mockResolvedValue([])
    createForDoctor.mockRejectedValue(new Error('create failed'))
    const wrapper = await openCreateDialog()
    await pickOption(document.body, '#e-doctor', '5')
    bodyButton('Select days')!.click()
    await flushPromises()
    await pickDays(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createForDoctor).toHaveBeenCalledWith(5, {
      startDate: '2026-09-07',
      endDate: '2026-09-11',
    })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('create failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('marks days one record per consecutive range and skips already-excluded days', async () => {
    const other = { ...record, id: 2, startDate: '2026-09-08', endDate: '2026-09-09' }
    doctorList.mockResolvedValue([doctor])
    listAll.mockImplementation(async (q?: { doctorId?: number }) =>
      q?.doctorId === 5 ? [other] : [],
    )
    createForDoctor.mockResolvedValue({})
    const wrapper = await openCreateDialog()
    await pickOption(document.body, '#e-doctor', '5')
    bodyButton('Select days')!.click()
    await flushPromises()
    await pickDays(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createForDoctor).toHaveBeenCalledTimes(2)
    expect(createForDoctor).toHaveBeenNthCalledWith(1, 5, {
      startDate: '2026-09-07',
      endDate: '2026-09-07',
    })
    expect(createForDoctor).toHaveBeenNthCalledWith(2, 5, {
      startDate: '2026-09-10',
      endDate: '2026-09-11',
    })
    wrapper.unmount()
  })

  it('edit with a split selection updates the record to the first range and creates the rest', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    update.mockResolvedValue({})
    createForDoctor.mockResolvedValue({})
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('Jane Roe'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '2026-09-07')!.trigger('click')
    await flushPromises()

    bodyButton('Select days')!.click()
    await flushPromises()
    // Pre-marked 07-11 plus a second run on 21-22.
    await pickDays(['2026-09-21', '2026-09-22'])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { startDate: '2026-09-07', endDate: '2026-09-11' })
    expect(createForDoctor).toHaveBeenCalledTimes(1)
    expect(createForDoctor).toHaveBeenCalledWith(5, { startDate: '2026-09-21', endDate: '2026-09-22' })
    wrapper.unmount()
  })

  it('clicking the calendar backdrop closes only the calendar, keeping the edit dialog open', async () => {
    doctorList.mockResolvedValue([doctor])
    listAll.mockResolvedValue([])
    const wrapper = await openCreateDialog()
    await pickOption(document.body, '#e-doctor', '5')
    bodyButton('Select days')!.click()
    await flushPromises()
    // The calendar is teleported after the edit dialog, so its backdrop is the
    // last .animate-dialog-backdrop in the body.
    const backdrops = Array.from(document.body.querySelectorAll('.animate-dialog-backdrop'))
    backdrops[backdrops.length - 1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('button[data-date]')).toBeNull()
    expect(bodyButton('Save')).toBeTruthy()
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when update fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    update.mockRejectedValue(new Error('update failed'))
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('Jane Roe'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '2026-09-07')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { startDate: '2026-09-07', endDate: '2026-09-11' })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('update failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('delete from the edit dialog shows an inline error when it fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    remove.mockRejectedValue(new Error('delete failed'))
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('Jane Roe'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === '2026-09-07')!.trigger('click')
    await flushPromises()
    bodyButton('Delete')!.click()
    await flushPromises()
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('delete failed')
    expect(bodyButton('Save')).toBeTruthy()
    wrapper.unmount()
  })
})
