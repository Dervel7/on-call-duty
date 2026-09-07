import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'

vi.mock('@/services/user', () => ({
  list: vi.fn(async () => [
    { id: 1, email: 'a@h.com', username: 'alice', firstName: 'A', lastName: 'A', role: 'administrator', isActive: true },
  ]),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@/services/doctor', () => ({
  list: vi.fn(async () => []),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import DefaultLayout from '../layouts/DefaultLayout.vue'
import UsersPage from '../pages/UsersPage.vue'
import { useConfirm } from '../composables/useConfirm'

describe('full layout repro', () => {
  it('new/edit/delete open dialogs with native clicks', async () => {
    setActivePinia(createPinia())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/',
          component: DefaultLayout,
          children: [{ path: '', component: UsersPage }],
        },
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount({ template: '<RouterView />' }, {
      global: { plugins: [router, createPinia()] },
      attachTo: document.body,
    })
    await flushPromises()
    await nextTick()

    const allButtons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent?.trim())

    // 1. New user
    const newBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New user') as HTMLElement
    expect(newBtn).toBeTruthy()
    newBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))
    // eslint-disable-next-line no-console
    console.log('AFTER NEW CLICK buttons:', JSON.stringify(allButtons().slice(0, 20)))
    // eslint-disable-next-line no-console
    console.log('AFTER NEW CLICK h2:', document.body.querySelector('h2')?.textContent)
    const dialogVisible1 = [...document.body.querySelectorAll('h2')].some((h) => h.textContent === 'New user')
    // eslint-disable-next-line no-console
    console.log('DIALOG OPEN (new):', dialogVisible1)

    // close via Close button if open
    const closeBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close') as HTMLElement | undefined
    if (closeBtn) {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await flushPromises()
      await new Promise((r) => setTimeout(r, 20))
    }
    // eslint-disable-next-line no-console
    console.log('AFTER CLOSE h2 count:', document.body.querySelectorAll('h2').length)

    // 2. Edit
    const editBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit') as HTMLElement
    editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))
    // eslint-disable-next-line no-console
    console.log('DIALOG OPEN (edit):', [...document.body.querySelectorAll('h2')].map((h) => h.textContent))

    // 3. Delete -> confirm (do not await, check request appears)
    const { confirm } = useConfirm()
    const p = confirm({ title: 'Delete user', message: 'Sure?' })
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))
    // eslint-disable-next-line no-console
    console.log('CONFIRM OPEN:', [...document.body.querySelectorAll('h2')].map((h) => h.textContent))
    // eslint-disable-next-line no-console
    console.log('CONFIRM BUTTONS:', JSON.stringify(allButtons().slice(0, 30)))
    p.then(() => undefined)
    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
