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
})
