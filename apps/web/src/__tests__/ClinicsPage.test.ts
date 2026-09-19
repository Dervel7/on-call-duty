import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Clinic, User } from '@oncall/shared'

const listClinics = vi.fn()
const createClinic = vi.fn()
const updateClinic = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => listClinics(...a),
  create: (...a: unknown[]) => createClinic(...a),
  update: (...a: unknown[]) => updateClinic(...a),
}))

const listUsers = vi.fn()
const createUser = vi.fn()
const updateUser = vi.fn()
vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => listUsers(...a),
  create: (...a: unknown[]) => createUser(...a),
  update: (...a: unknown[]) => updateUser(...a),
}))

const confirm = vi.fn()
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => confirm(...a) }),
}))

import ClinicsPage from '../pages/ClinicsPage.vue'

const clinics: Clinic[] = [
  { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 2, name: 'Cardiology', isActive: false, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
]

function adminUser(overrides: Partial<User> = {}): User {
  return {
    id: 11,
    email: 'rad.admin@h.local',
    username: 'rad.admin',
    role: 'administrator',
    firstName: 'Rad',
    lastName: 'Admin',
    isActive: true,
    darkMode: false,
    clinicId: 1,
    clinicName: 'Radiology',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function bodyButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
}

function setBodyValue(selector: string, value: string) {
  const el = document.body.querySelector(selector) as HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event('input'))
}

async function mountPage(path = '/clinics') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(ClinicsPage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  listClinics.mockReset()
  createClinic.mockReset()
  updateClinic.mockReset()
  listUsers.mockReset()
  createUser.mockReset()
  updateUser.mockReset()
  confirm.mockReset()
})

describe('ClinicsPage', () => {
  it('renders the clinic table with status and counts', async () => {
    listClinics.mockResolvedValue(clinics)
    const wrapper = await mountPage()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Radiology')
    expect(rows[0]!.text()).toContain('Active')
    expect(rows[0]!.text()).toContain('3')
    expect(rows[1]!.text()).toContain('Cardiology')
    expect(rows[1]!.text()).toContain('Inactive')
    wrapper.unmount()
  })

  it('create flow: schema error inline, then service call and reload', async () => {
    listClinics.mockResolvedValue(clinics)
    createClinic.mockResolvedValue(clinics[0]!)
    const wrapper = await mountPage()
    wrapper.findAll('button').find((b) => b.text() === 'New clinic')!.trigger('click')
    await flushPromises()

    setBodyValue('#c-name', 'x')
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createClinic).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy()

    setBodyValue('#c-name', 'Oncology')
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createClinic).toHaveBeenCalledWith({ name: 'Oncology' })
    expect(listClinics).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('rename flow: opens with the current name and updates via the service', async () => {
    listClinics.mockResolvedValue(clinics)
    updateClinic.mockResolvedValue(clinics[0]!)
    const wrapper = await mountPage()
    wrapper.findAll('button').find((b) => b.text() === 'Rename')!.trigger('click')
    await flushPromises()
    expect((document.body.querySelector('#r-name') as HTMLInputElement).value).toBe('Radiology')
    setBodyValue('#r-name', 'Radiology Dept')
    bodyButton('Save')!.click()
    await flushPromises()
    expect(updateClinic).toHaveBeenCalledWith(1, { name: 'Radiology Dept' })
    wrapper.unmount()
  })

  it('deactivate asks for confirmation; cancel leaves the clinic untouched', async () => {
    listClinics.mockResolvedValue(clinics)
    const wrapper = await mountPage()
    confirm.mockResolvedValue(false)
    wrapper.findAll('button').find((b) => b.text() === 'Deactivate')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(updateClinic).not.toHaveBeenCalled()

    confirm.mockResolvedValue(true)
    wrapper.findAll('button').find((b) => b.text() === 'Deactivate')!.trigger('click')
    await flushPromises()
    expect(updateClinic).toHaveBeenCalledWith(1, { isActive: false })
    wrapper.unmount()
  })

  it('reactivate skips the confirm dialog', async () => {
    listClinics.mockResolvedValue(clinics)
    const wrapper = await mountPage()
    wrapper.findAll('button').find((b) => b.text() === 'Reactivate')!.trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(updateClinic).toHaveBeenCalledWith(2, { isActive: true })
    wrapper.unmount()
  })

  it('administrator management: lists administrators of the selected clinic and creates one', async () => {
    listClinics.mockResolvedValue(clinics)
    listUsers.mockResolvedValue([adminUser()])
    createUser.mockResolvedValue(adminUser())
    const wrapper = await mountPage('/clinics?clinic=1')
    await flushPromises()
    expect(listUsers).toHaveBeenCalledWith(1)
    const section = wrapper.find('[data-testid="clinic-admins"]')
    expect(section.text()).toContain('rad.admin@h.local')

    wrapper.findAll('button').find((b) => b.text() === 'New administrator')!.trigger('click')
    await flushPromises()
    setBodyValue('#a-first', 'New')
    setBodyValue('#a-last', 'Admin')
    setBodyValue('#a-email', 'new.admin@h.local')
    setBodyValue('#a-username', 'new.admin')
    setBodyValue('#a-password', 'changeme123')
    bodyButton('Save')!.click()
    await flushPromises()
    expect(createUser).toHaveBeenCalledWith({
      firstName: 'New',
      lastName: 'Admin',
      email: 'new.admin@h.local',
      username: 'new.admin',
      password: 'changeme123',
      role: 'administrator',
      clinicId: 1,
    })
    wrapper.unmount()
  })
})
