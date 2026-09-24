import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextMonthIso } from '@oncall/utils'

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
import { pickDays } from './pick-days'

const { settle } = useConfirmState()

const record = {
  id: 1,
  doctorId: 5,
  doctorFirstName: 'Jane',
  doctorLastName: 'Roe',
  startDate: '2026-09-15',
  endDate: '2026-09-15',
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
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function bodyButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  )
}

async function mountPage() {
  const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  return wrapper
}

async function openCreateDialog() {
  const wrapper = await mountPage()
  await wrapper.findAll('button').find((b) => b.text() === 'New exclusion')!.trigger('click')
  await flushPromises()
  return wrapper
}

describe('MyAvailabilityPage', () => {
  it('renders one button per excluded day of the selected month, fetched once', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([
      { ...record, startDate: `${nm}-07`, endDate: `${nm}-08` },
      { ...record, id: 2, startDate: '2020-01-05', endDate: '2020-01-06' },
    ])
    const wrapper = await mountPage()
    expect(listMine).toHaveBeenCalledTimes(1)
    expect(listMine).toHaveBeenCalledWith()
    const days = wrapper
      .findAll('button')
      .filter((b) => b.text().startsWith('20'))
      .map((b) => b.text())
    expect(days).toEqual([`${nm}-07`, `${nm}-08`])
    wrapper.unmount()
  })

  it('shows an error when listing fails', async () => {
    listMine.mockRejectedValue(new Error('nope'))
    const wrapper = await mountPage()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
    wrapper.unmount()
  })

  it('opens the day calendar on the next month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-25T12:00:00') })
    listMine.mockResolvedValue([])
    const wrapper = await openCreateDialog()
    bodyButton('Select days')!.click()
    await flushPromises()
    expect(document.body.querySelector('[data-month]')?.getAttribute('data-month')).toBe(
      '2026-10',
    )
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when create fails', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([])
    createMine.mockRejectedValue(new Error('create failed'))
    const wrapper = await openCreateDialog()
    bodyButton('Select days')!.click()
    await flushPromises()
    await pickDays([`${nm}-07`, `${nm}-08`, `${nm}-09`, `${nm}-10`, `${nm}-11`])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createMine).toHaveBeenCalledWith({
      startDate: `${nm}-07`,
      endDate: `${nm}-11`,
    })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('create failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('marks days one record per consecutive range and skips already-excluded days', async () => {
    const nm = nextMonthIso()
    const other = { ...record, id: 2, startDate: `${nm}-08`, endDate: `${nm}-09` }
    listMine.mockResolvedValue([other])
    createMine.mockResolvedValue({})
    const wrapper = await openCreateDialog()
    bodyButton('Select days')!.click()
    await flushPromises()
    // 08–09 are reserved by the other record: the calendar disables them, so
    // only 07 and 10–11 can be marked.
    await pickDays([`${nm}-07`, `${nm}-08`, `${nm}-09`, `${nm}-10`, `${nm}-11`])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createMine).toHaveBeenCalledTimes(2)
    expect(createMine).toHaveBeenNthCalledWith(1, {
      startDate: `${nm}-07`,
      endDate: `${nm}-07`,
    })
    expect(createMine).toHaveBeenNthCalledWith(2, {
      startDate: `${nm}-10`,
      endDate: `${nm}-11`,
    })
    wrapper.unmount()
  })

  it('skips days reserved by another session since the calendar was opened', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([])
    createMine.mockResolvedValue({})
    const wrapper = await openCreateDialog()
    bodyButton('Select days')!.click()
    await flushPromises()
    await pickDays([`${nm}-07`, `${nm}-08`, `${nm}-09`, `${nm}-10`, `${nm}-11`])
    // Another session adds 08–09 between marking and saving; save() re-fetches
    // and silently skips them instead of failing with a 409.
    listMine.mockResolvedValue([{ ...record, id: 2, startDate: `${nm}-08`, endDate: `${nm}-09` }])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createMine).toHaveBeenCalledTimes(2)
    expect(createMine).toHaveBeenNthCalledWith(1, {
      startDate: `${nm}-07`,
      endDate: `${nm}-07`,
    })
    expect(createMine).toHaveBeenNthCalledWith(2, {
      startDate: `${nm}-10`,
      endDate: `${nm}-11`,
    })
    wrapper.unmount()
  })

  it('edit with a split selection updates the record to the first range and creates the rest', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([{ ...record, startDate: `${nm}-07`, endDate: `${nm}-11` }])
    update.mockResolvedValue({})
    createMine.mockResolvedValue({})
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === `${nm}-07`)!.trigger('click')
    await flushPromises()

    bodyButton('Select days')!.click()
    await flushPromises()
    // Pre-marked 07–11 plus a second run on 21–22.
    await pickDays([`${nm}-21`, `${nm}-22`])
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { startDate: `${nm}-07`, endDate: `${nm}-11` })
    expect(createMine).toHaveBeenCalledTimes(1)
    expect(createMine).toHaveBeenCalledWith({ startDate: `${nm}-21`, endDate: `${nm}-22` })
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when update fails', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([{ ...record, startDate: `${nm}-07`, endDate: `${nm}-11` }])
    update.mockRejectedValue(new Error('update failed'))
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === `${nm}-07`)!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { startDate: `${nm}-07`, endDate: `${nm}-11` })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('update failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('filters days client side when the month changes, without refetching', async () => {
    const nm = nextMonthIso()
    // The month after the default one, crossing a year boundary when needed.
    const [ny, nm0] = nm.split('-').map(Number) as [number, number]
    const target = new Date(ny, nm0, 1)
    const targetMonth = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`
    listMine.mockResolvedValue([
      { ...record, startDate: `${nm}-07`, endDate: `${nm}-07` },
      { ...record, id: 2, startDate: `${targetMonth}-05`, endDate: `${targetMonth}-06` },
    ])
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain(`${nm}-07`)
    expect(wrapper.text()).not.toContain(`${targetMonth}-05`)

    await wrapper.find('#f-month').trigger('click')
    await flushPromises()
    if (target.getFullYear() !== ny) {
      await wrapper.find('[aria-label="Next year"]').trigger('click')
    }
    await wrapper.find(`[data-month="${targetMonth}"]`).trigger('click')
    await flushPromises()
    expect(listMine).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain(`${nm}-07`)
    expect(wrapper.text()).toContain(`${targetMonth}-05`)
    expect(wrapper.text()).toContain(`${targetMonth}-06`)
    wrapper.unmount()
  })

  it('delete from the edit dialog shows an inline error when it fails', async () => {
    const nm = nextMonthIso()
    listMine.mockResolvedValue([{ ...record, startDate: `${nm}-07`, endDate: `${nm}-11` }])
    remove.mockRejectedValue(new Error('delete failed'))
    const wrapper = await mountPage()
    await wrapper.findAll('button').find((b) => b.text() === `${nm}-07`)!.trigger('click')
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
