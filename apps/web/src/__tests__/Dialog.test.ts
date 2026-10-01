import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
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
})
