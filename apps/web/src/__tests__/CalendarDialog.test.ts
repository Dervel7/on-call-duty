import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import CalendarDialog from '../components/ui/CalendarDialog.vue'
import { navigateToMonth } from './pick-days'

function day(iso: string): HTMLButtonElement {
  return document.body.querySelector(`button[data-date="${iso}"]`) as HTMLButtonElement
}

async function clickDay(iso: string) {
  await navigateToMonth(document.body, iso)
  day(iso).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

function confirmButton(): HTMLButtonElement {
  return Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Confirm'),
  ) as HTMLButtonElement
}

describe('CalendarDialog', () => {
  it('labels day cells with the full date', async () => {
    const wrapper = mount(CalendarDialog, { props: { open: true, modelValue: ['2026-09-07'] } })
    await flushPromises()
    expect(day('2026-09-07').getAttribute('aria-label')).toBe('Monday, 7 September 2026')
    wrapper.unmount()
  })

  it('toggles days and emits them sorted on confirm', async () => {
    const wrapper = mount(CalendarDialog, { props: { open: true, modelValue: [] } })
    await clickDay('2026-09-11')
    await clickDay('2026-09-07')
    await clickDay('2026-09-09')
    await clickDay('2026-09-09') // toggle back off
    confirmButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['2026-09-07', '2026-09-11']])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('cannot select reserved days and keeps confirm disabled without a selection', async () => {
    const wrapper = mount(CalendarDialog, {
      props: { open: true, modelValue: [], reservedDays: ['2026-09-24'] },
    })
    await navigateToMonth(document.body, '2026-09-24')
    expect(day('2026-09-24').disabled).toBe(true)
    expect(confirmButton().disabled).toBe(true)
    wrapper.unmount()
  })

  it('opens on initialMonth when no day is preselected', async () => {
    const wrapper = mount(CalendarDialog, {
      props: { open: true, modelValue: [], initialMonth: '2026-10' },
    })
    await flushPromises()
    expect(document.body.querySelector('[data-month]')?.getAttribute('data-month')).toBe(
      '2026-10',
    )
    wrapper.unmount()
  })

  it('prefers the first preselected day over initialMonth', async () => {
    const wrapper = mount(CalendarDialog, {
      props: { open: true, modelValue: ['2026-09-07'], initialMonth: '2026-10' },
    })
    await flushPromises()
    expect(document.body.querySelector('[data-month]')?.getAttribute('data-month')).toBe(
      '2026-09',
    )
    wrapper.unmount()
  })

  it('closes via the top-right X', async () => {
    const wrapper = mount(CalendarDialog, { props: { open: true, modelValue: [] } })
    document.body
      .querySelector('button[aria-label="Close"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('is a labelled modal that focuses inside and restores focus on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const wrapper = mount(CalendarDialog, {
      props: { open: false, modelValue: [], title: 'Pick' },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await flushPromises()

    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('Pick')
    expect(panel.contains(document.activeElement)).toBe(true)

    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })
})
