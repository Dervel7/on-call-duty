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

const route = { query: {} as Record<string, string> }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => route,
}))

const clinicsList = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => clinicsList(...a),
  create: vi.fn(),
  update: vi.fn(),
}))
 
 import AvailabilityPage from '../pages/AvailabilityPage.vue'
import { useAuthStore } from '../stores/auth'
 import { useConfirmState } from '../composables/useConfirm'
 import { pickDate } from './pick-date'
 import { pickOption } from './pick-option'
 
 const { settle } = useConfirmState()

function mountAs(role: 'administrator' | 'manager') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = {
    id: 2,
    email: 'a@b.com',
    username: 'admin',
    role,
    firstName: 'Ada',
    lastName: 'Ops',
    darkMode: false,
    clinicId: role === 'manager' ? null : 1,
    clinicName: role === 'manager' ? null : 'Radiology',
  }
  clinicsList.mockResolvedValue([
    { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1 },
    { id: 2, name: 'Cardiology', isActive: true, doctorCount: 3, adminCount: 1 },
  ])
  return mount(AvailabilityPage, { global: { plugins: [pinia] } })
}

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
  type: 'vacation',
  startDate: '2026-09-07',
  endDate: '2026-09-11',
  note: 'Summer break',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  route.query = {}
  listAll.mockReset()
  doctorList.mockReset()
  createForDoctor.mockReset()
  update.mockReset()
  remove.mockReset()
  clinicsList.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

function bodyButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  )
}



describe('AvailabilityPage', () => {
  it('renders the list on mount', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('Jane')
    expect(wrapper.text()).toContain('2026-09-07')
  })

  it('shows an error when listing fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockRejectedValue(new Error('nope'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('keeps the dialog open with an inline error when create fails', async () => {
    doctorList.mockResolvedValue([doctor])
    listAll.mockResolvedValue([])
    createForDoctor.mockRejectedValue(new Error('create failed'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New exclusion')!.trigger('click')
    await flushPromises()
    await pickOption(document.body, '#e-doctor', '5')
    await pickDate(document.body, '#e-start', '2026-09-07')
    await pickDate(document.body, '#e-end', '2026-09-11')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createForDoctor).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ type: 'vacation', startDate: '2026-09-07' }),
    )
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('create failed')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when update fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    update.mockRejectedValue(new Error('update failed'))
    const wrapper = mountAs('administrator')
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
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    remove.mockRejectedValue(new Error('delete failed'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(wrapper.find('[role="alert"]').text()).toContain('delete failed')
  })

  it('manager mode: no lifecycle controls, records and doctors scoped to the clinic', async () => {
    route.query = { clinic: '2' }
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([record])
    const wrapper = mountAs('manager')
    await flushPromises()

    expect(wrapper.find('[data-testid="clinic-selector"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('New exclusion')
    expect(wrapper.text()).not.toContain('Edit')
    expect(wrapper.text()).not.toContain('Delete')
    expect(listAll).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 2 }))
    expect(doctorList).toHaveBeenCalledWith(2)
  })

  it('manager mode without a clinic selection skips the fetch', async () => {
    const wrapper = mountAs('manager')
    await flushPromises()
    expect(listAll).not.toHaveBeenCalled()
    expect(doctorList).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Select a clinic above to view its availability.')
  })
})
