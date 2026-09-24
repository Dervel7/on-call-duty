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
})
