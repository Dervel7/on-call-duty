import { flushPromises } from '@vue/test-utils'

/**
 * Opens the modern Select behind `trigger` and clicks the option whose value
 * is `value` (string, as the Select emits). The option list is teleported to
 * document.body, so it is looked up there.
 */
export async function pickOptionFrom(trigger: Element, value: string) {
  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const opt = document.body.querySelector(`button[data-value="${value}"]`) as HTMLElement
  opt.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

export async function pickOption(scope: ParentNode, selector: string, value: string) {
  const trigger = scope.querySelector(selector)
  if (!trigger) throw new Error(`Select trigger not found: ${selector}`)
  await pickOptionFrom(trigger, value)
}
