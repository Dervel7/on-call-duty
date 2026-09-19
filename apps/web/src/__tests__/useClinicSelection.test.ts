import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useClinicSelection } from '../composables/useClinicSelection'

const Harness = defineComponent({
  setup() {
    const { selectedClinicId, setClinic } = useClinicSelection()
    return { selectedClinicId, setClinic }
  },
  template: '<div />',
})

async function harnessAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: Harness }],
  })
  await router.push(path)
  const wrapper = mount(Harness, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('useClinicSelection', () => {
  it('reads the clinic id from the query', async () => {
    const { wrapper } = await harnessAt('/schedules?clinic=3')
    expect(wrapper.vm.selectedClinicId).toBe(3)
  })

  it('ignores missing or non-numeric values', async () => {
    const none = await harnessAt('/schedules')
    expect(none.wrapper.vm.selectedClinicId).toBeUndefined()
    const bad = await harnessAt('/schedules?clinic=abc')
    expect(bad.wrapper.vm.selectedClinicId).toBeUndefined()
  })

  it('setClinic replaces the route query, preserving other params', async () => {
    const { wrapper, router } = await harnessAt('/schedules?clinic=1&year=2026')
    wrapper.vm.setClinic(2)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ clinic: '2', year: '2026' })
    expect(wrapper.vm.selectedClinicId).toBe(2)
  })

  it('setClinic(undefined) removes the param', async () => {
    const { wrapper, router } = await harnessAt('/schedules?clinic=1&year=2026')
    wrapper.vm.setClinic(undefined)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ year: '2026' })
    expect(wrapper.vm.selectedClinicId).toBeUndefined()
  })
})
