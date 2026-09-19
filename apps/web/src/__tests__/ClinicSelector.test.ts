import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AuthUser, Clinic } from '@oncall/shared'

const listClinics = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => listClinics(...a),
}))

import Select from '@/components/ui/Select.vue'
import ClinicSelector from '../components/layout/ClinicSelector.vue'
import { useAuthStore } from '@/stores/auth'

const clinics: Clinic[] = [
  { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 2, name: 'Cardiology', isActive: true, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
]

function user(role: AuthUser['role']): AuthUser {
  const managerLike = role === 'manager' || role === 'superadmin'
  return {
    id: 1,
    email: 'a@b.c',
    username: 'user',
    role,
    firstName: 'A',
    lastName: 'B',
    darkMode: false,
    clinicId: managerLike ? null : 1,
    clinicName: managerLike ? null : 'Radiology',
  }
}

async function mountSelector(role: AuthUser['role'], path = '/schedules') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = user(role)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(ClinicSelector, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => listClinics.mockReset())

describe('ClinicSelector', () => {
  it('renders nothing for non-manager roles', async () => {
    for (const role of ['administrator', 'doctor', 'superadmin'] as const) {
      const { wrapper } = await mountSelector(role)
      expect(wrapper.find('[data-testid="clinic-selector"]').exists()).toBe(false)
    }
    expect(listClinics).not.toHaveBeenCalled()
  })

  it('renders one option per clinic for a manager', async () => {
    listClinics.mockResolvedValue(clinics)
    const { wrapper } = await mountSelector('manager')
    await wrapper.find('button[role="combobox"]').trigger('click')
    const options = Array.from(document.body.querySelectorAll('[role="listbox"] button'))
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Select a clinic', 'Radiology', 'Cardiology'])
    wrapper.unmount()
  })

  it('updates the route query when a clinic is picked', async () => {
    listClinics.mockResolvedValue(clinics)
    const { wrapper, router } = await mountSelector('manager', '/schedules?clinic=1')
    const select = wrapper.findComponent(Select)
    select.vm.$emit('update:modelValue', '2')
    await flushPromises()
    expect(router.currentRoute.value.query.clinic).toBe('2')
  })

})
