import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { useConfirm, useConfirmState } from '../composables/useConfirm'

const { request, settle } = useConfirmState()
const { confirm } = useConfirm()

function hostButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'))
}

function overlay(): HTMLElement | null {
  return document.body.querySelector('div[class*="backdrop-blur"]')
}

const wrappers: VueWrapper[] = []

function mountHost(): VueWrapper {
  const w = mount(ConfirmDialog, { attachTo: document.body })
  wrappers.push(w)
  return w
}

afterEach(() => {
  settle(false)
  wrappers.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

describe('ConfirmDialog', () => {
  it('renders title, message, and default labels; focuses Cancel when destructive', async () => {
    mountHost()
    const p = confirm({ title: 'Delete schedule', message: 'Delete this schedule and all its duties?' })
    await flushPromises()
    await flushPromises()
    expect(document.body.textContent).toContain('Delete schedule')
    expect(document.body.textContent).toContain('Delete this schedule and all its duties?')
    expect(hostButtons().map((b) => b.textContent)).toEqual(['Cancel', 'Confirm'])
    expect(document.activeElement?.textContent).toBe('Cancel')
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('Confirm click resolves true and clears state', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    hostButtons()[1]!.click()
    await expect(p).resolves.toBe(true)
    expect(request.value).toBeNull()
    await flushPromises()
    expect(hostButtons()).toEqual([])
  })

  it('Cancel click resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    hostButtons()[0]!.click()
    await expect(p).resolves.toBe(false)
  })

  it('Escape resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(p).resolves.toBe(false)
  })

  it('overlay click resolves false', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    const el = overlay()
    expect(el).not.toBeNull()
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await expect(p).resolves.toBe(false)
  })

  it('renders custom labels', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm', confirmText: 'Delete', cancelText: 'Keep' })
    await flushPromises()
    expect(hostButtons().map((b) => b.textContent)).toEqual(['Keep', 'Delete'])
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('applies destructive and primary variants', async () => {
    mountHost()
    const p1 = confirm({ title: 'T', message: 'm' })
    await flushPromises()
    expect(hostButtons()[1]!.className).toContain('bg-destructive')
    expect(document.body.querySelector('span[class*="rounded-full"]')?.className).toContain('bg-destructive/10')
    settle(true)
    await expect(p1).resolves.toBe(true)
    const p2 = confirm({ title: 'T', message: 'm', variant: 'primary' })
    await flushPromises()
    expect(hostButtons()[1]!.className).toContain('bg-primary')
    expect(document.body.querySelector('span[class*="rounded-full"]')?.className).toContain('bg-primary/10')
    settle(true)
    await expect(p2).resolves.toBe(true)
  })

  it('focuses Confirm when primary', async () => {
    mountHost()
    const p = confirm({ title: 'T', message: 'm', variant: 'primary' })
    await flushPromises()
    await flushPromises()
    expect(document.activeElement?.textContent).toBe('Confirm')
    settle(true)
    await expect(p).resolves.toBe(true)
  })

  it('double settle is a no-op and a second confirm resolves the first with false', async () => {
    mountHost()
    const p1 = confirm({ title: 'A', message: 'a' })
    const p2 = confirm({ title: 'B', message: 'b' })
    await expect(p1).resolves.toBe(false)
    settle(true)
    settle(true)
    await expect(p2).resolves.toBe(true)
    expect(request.value).toBeNull()
  })
})
