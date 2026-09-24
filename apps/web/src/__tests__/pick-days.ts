import { flushPromises } from '@vue/test-utils'

/** Navigates the open calendar to the month of `iso` (same contract as pick-date). */
export async function navigateToMonth(scope: ParentNode, iso: string) {
  const [year, month] = iso.split('-').map(Number) as [number, number]
  for (let i = 0; i < 24; i++) {
    const current = scope.querySelector('[data-month]')?.getAttribute('data-month')
    if (!current) break
    const [vy, vm] = current.split('-').map(Number) as [number, number]
    const diff = (year - vy) * 12 + (month - vm)
    if (diff === 0) break
    const nav = scope.querySelector(
      `[aria-label="${diff > 0 ? 'Next' : 'Previous'} month"]`,
    ) as HTMLElement
    nav.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }
}

/**
 * Drives the CalendarDialog the way a user would: for each ISO day, navigates
 * to its month and clicks the day toggle, then presses Confirm. Reserved
 * (disabled) days cannot be clicked, exactly like in the browser.
 */
export async function pickDays(isos: string[]) {
  const scope = document.body
  for (const iso of isos) {
    await navigateToMonth(scope, iso)
    scope
      .querySelector(`button[data-date="${iso}"]:not([disabled])`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }
  const confirm = Array.from(scope.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('Confirm'),
  ) as HTMLElement
  confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}
