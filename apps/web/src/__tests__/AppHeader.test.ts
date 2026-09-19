import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AuthUser, Clinic } from '@oncall/shared'

const listClinics = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => listClinics(...a),
}))

import AppHeader from '../components/layout/AppHeader.vue'
import { useAuthStore } from '@/stores/auth'

const clinics: Clinic[] = [
  { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 2, name: 'Cardiology', isActive: true, doctorCount: 3, adminCount: 1, createdAt: '2026-01-01T00:00:00.000Z' },
]

function user(role: AuthUser['role']): AuthUser {
  const clinicLess = role === 'manager' || role === 'superadmin'
  return {
    id: 1,
    email: 'a@b.c',
    username: 'user',
    role,
    firstName: 'A',
    lastName: 'B',
    darkMode: false,
    clinicId: clinicLess ? null : 1,
    clinicName: clinicLess ? null : 'Radiology',
  }
}

async function mountHeader(role: AuthUser['role'], path = '/') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = user(role)
  useAuthStore(pinia).accessToken = 'test-token'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  const wrapper = mount(AppHeader, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

function navLabels(wrapper: Awaited<ReturnType<typeof mountHeader>>): string[] {
  return wrapper.findAll('nav a').map((a) => a.text())
}

beforeEach(() => listClinics.mockReset())

describe('AppHeader', () => {
  it('administrator: chip shows own clinic; nav has management items, no Clinics/Usage', async () => {
    const w = await mountHeader('administrator')
    expect(w.find('[data-testid="clinic-chip"]').text()).toBe('Radiology')
    const nav = navLabels(w)
    expect(nav).toEqual(['Home', 'Users', 'Availability', 'Schedules', 'Reports', 'Activity', 'Profile'])
  })

  it('doctor: chip shows own clinic; nav has roster and my availability only for them', async () => {
    const w = await mountHeader('doctor')
    expect(w.find('[data-testid="clinic-chip"]').text()).toBe('Radiology')
    const nav = navLabels(w)
    expect(nav).toEqual(['Home', 'Duty roster', 'My availability', 'Profile'])
  })

  it('superadmin: no clinic chip; nav keeps Usage and has no Clinics', async () => {
    const w = await mountHeader('superadmin')
    expect(w.find('[data-testid="clinic-chip"]').exists()).toBe(false)
    const nav = navLabels(w)
    expect(nav).toContain('Usage')
    expect(nav).not.toContain('Clinics')
    expect(nav).not.toContain('Duty roster')
  })

  it('manager: chip says All clinics; nav is drill-down plus Clinics, without roster/my-availability/Usage', async () => {
    listClinics.mockResolvedValue(clinics)
    const w = await mountHeader('manager')
    expect(w.find('[data-testid="clinic-chip"]').text()).toBe('All clinics')
    const nav = navLabels(w)
    expect(nav).toEqual(['Home', 'Users', 'Availability', 'Schedules', 'Reports', 'Activity', 'Clinics', 'Profile'])
  })

  it('manager with a selected clinic: chip shows that clinic name', async () => {
    listClinics.mockResolvedValue(clinics)
    const w = await mountHeader('manager', '/schedules?clinic=2')
    expect(w.find('[data-testid="clinic-chip"]').text()).toBe('Cardiology')
  })
})
