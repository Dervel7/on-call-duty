import { flushPromises } from '@vue/test-utils'

/**
 * Drives the DatePicker UI the way a user would: opens the picker behind
 * `selector`, navigates to the target month, and clicks the day `iso`.
 * `scope` is the element containing the picker trigger.
 */
export async function pickDate(scope: ParentNode, selector: string, iso: string) {
  const btn = scope.querySelector(selector) as HTMLElement
  // The panel is teleported to body.
  const rootEl = document.body
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const [year, month] = iso.split('-').map(Number) as [number, number]
  for (let i = 0; i < 24; i++) {
    const current = rootEl.querySelector('[data-month]')?.getAttribute('data-month')
    if (!current) break
    const [vy, vm] = current.split('-').map(Number) as [number, number]
    const diff = (year - vy) * 12 + (month - vm)
    if (diff === 0) break
    const nav = rootEl.querySelector(
      `[aria-label="${diff > 0 ? 'Next' : 'Previous'} month"]`,
    ) as HTMLElement
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }
  ;(rootEl.querySelector(`button[data-date="${iso}"]`) as HTMLElement).dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  )
  await flushPromises()
}
