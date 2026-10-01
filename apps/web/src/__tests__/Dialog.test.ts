import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

import Dialog from '../components/ui/Dialog.vue'

describe('Dialog', () => {
  it('closes via the top-right X instead of a Close footer button', async () => {
    const wrapper = mount(Dialog, { props: { open: true, title: 'Test' } })
    const labels = Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).not.toContain('Close')

    document.body
      .querySelector('button[aria-label="Close"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('renders the footer slot when provided', () => {
    const wrapper = mount(Dialog, {
      props: { open: true },
      slots: { footer: '<button type="button">Do it</button>' },
    })
    const labels = Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toContain('Do it')
    wrapper.unmount()
  })

  it('a dialog mounted earlier but opened later stacks on top and alone reacts to clicks and Escape', async () => {
    // Mirrors ConfirmDialog (mounted once in the layout) opening over a page dialog.
    const confirm = mount(Dialog, {
      props: { open: false, title: 'Confirm' },
      slots: { default: '<button type="button" id="cancel">Cancel</button>' },
      attachTo: document.body,
    })
    const edit = mount(Dialog, { props: { open: true, title: 'Edit' }, attachTo: document.body })
    await confirm.setProps({ open: true })

    const layers = Array.from(document.body.querySelectorAll<HTMLElement>('[data-popover-layer]'))
    const zOf = (title: string) =>
      Number(layers.find((l) => l.textContent?.includes(title))!.style.zIndex)
    expect(zOf('Confirm')).toBeGreaterThan(zOf('Edit'))

    document.getElementById('cancel')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    document.getElementById('cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(edit.emitted('update:open')).toBeUndefined()
    expect(confirm.emitted('update:open')?.[0]).toEqual([false])

    confirm.unmount()
    edit.unmount()
  })

  it('is a labelled modal dialog that focuses inside, traps Tab and restores focus on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = mount(Dialog, {
      props: { open: false, title: 'Edit' },
      slots: { default: '<input id="field" />' },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await nextTick()

    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(panel.getAttribute('aria-modal')).toBe('true')
    const titleId = panel.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent?.trim()).toBe('Edit')

    const close = panel.querySelector<HTMLElement>('button[aria-label="Close"]')!
    const field = document.getElementById('field')!
    expect(document.activeElement).toBe(close)

    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(close)
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(field)

    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(opener)

    wrapper.unmount()
    opener.remove()
  })

  it('keeps body scroll locked until the last stacked dialog closes', async () => {
    const bottom = mount(Dialog, { props: { open: true, title: 'Bottom' }, attachTo: document.body })
    const top = mount(Dialog, { props: { open: true, title: 'Top' }, attachTo: document.body })
    expect(document.body.style.overflow).toBe('hidden')

    await top.setProps({ open: false })
    expect(document.body.style.overflow).toBe('hidden')

    await bottom.setProps({ open: false })
    expect(document.body.style.overflow).toBe('')

    top.unmount()
    bottom.unmount()
  })

  it('releases the scroll lock when unmounted while open', async () => {
    const show = ref(true)
    const Host = defineComponent(() => () => (show.value ? h(Dialog, { open: true, title: 'Page' }) : null))
    const host = mount(Host, { attachTo: document.body })
    expect(document.body.style.overflow).toBe('hidden')

    show.value = false
    await nextTick()
    expect(document.body.style.overflow).toBe('')
    host.unmount()
  })
})
