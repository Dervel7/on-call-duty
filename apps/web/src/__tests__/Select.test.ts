import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Select from '../components/ui/Select.vue'

/**
 * jsdom has no layout engine, so the geometry the popover direction depends on
 * (viewport height, button rect, panel content height) is stubbed per test.
 */
function stubGeometry(
  btnRect: { top: number; bottom: number; left: number; width: number },
  panelContentHeight: number,
  viewportHeight: number,
) {
  vi.stubGlobal('innerHeight', viewportHeight)
  const rect = {
    ...btnRect,
    right: btnRect.left + btnRect.width,
    height: btnRect.bottom - btnRect.top,
    x: btnRect.left,
    y: btnRect.top,
    toJSON: () => ({}),
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => panelContentHeight,
  })
}

let wrapper: VueWrapper | undefined

async function openPanel() {
  wrapper?.unmount()
  wrapper = mount(Select, {
    props: { modelValue: 'a' },
    slots: { default: '<option value="a">Alpha</option><option value="b">Beta</option>' },
    attachTo: document.body,
  })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  const panel = document.body.querySelector<HTMLElement>('[data-popover-layer]')
  return { panel }
}

afterEach(() => {
  // Unmount before clearing the body: a mounted Teleport whose container is
  // removed by innerHTML = '' crashes the next mount.
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  vi.unstubAllGlobals()
})

describe('Select popover direction', () => {
  it('opens above the button when the content cannot fit below (last calendar row)', async () => {
    // Button near the viewport bottom: 48px below vs 684px above.
    stubGeometry({ top: 700, bottom: 736, left: 100, width: 120 }, 300, 800)
    const { panel } = await openPanel()

    expect(panel).toBeTruthy()
    // Bottom edge anchored 6px above the button top: 800 - 700 + 6.
    expect(panel!.style.bottom).toBe('106px')
    expect(panel!.style.top).toBe('')
    expect(panel!.style.maxHeight).toBe('684px')
  })

  it('opens below the button when the content fits below', async () => {
    stubGeometry({ top: 100, bottom: 136, left: 100, width: 120 }, 300, 800)
    const { panel } = await openPanel()

    expect(panel).toBeTruthy()
    expect(panel!.style.top).toBe('142px')
    expect(panel!.style.bottom).toBe('')
    expect(panel!.style.maxHeight).toBe('648px')
  })
})

describe('Select keyboard focus', () => {
  async function openLabelled() {
    wrapper = mount(Select, {
      props: { modelValue: 'a', ariaLabel: '2026-09-01 slot 1' },
      slots: { default: '<option value="a">Alpha</option><option value="b">Beta</option>' },
      attachTo: document.body,
    })
    const trigger = wrapper.find('[role="combobox"]').element as HTMLButtonElement
    await wrapper.find('[role="combobox"]').trigger('click')
    await flushPromises()
    const panel = document.body.querySelector<HTMLElement>('[role="listbox"]')!
    expect(document.activeElement).toBe(panel)
    return { trigger, panel }
  }

  it('puts ariaLabel on the combobox button', async () => {
    const { trigger } = await openLabelled()
    expect(trigger.getAttribute('aria-label')).toBe('2026-09-01 slot 1')
  })

  it.each([
    ['choosing with Enter', { key: 'Enter' }],
    ['Escape', { key: 'Escape' }],
    ['Tab', { key: 'Tab' }],
  ])('returns focus to the trigger after %s', async (_, init) => {
    const { trigger, panel } = await openLabelled()
    panel.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('Select arrow keys with no active option', () => {
  async function openUnselected(options: string) {
    wrapper = mount(Select, { props: { modelValue: '' }, slots: { default: options }, attachTo: document.body })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    return document.body.querySelector<HTMLElement>('[data-popover-layer]')!
  }

  function activeText(panel: HTMLElement): string | undefined {
    const id = panel.getAttribute('aria-activedescendant')
    return id ? document.getElementById(id)?.textContent?.trim() : undefined
  }

  async function press(panel: HTMLElement, key: string) {
    panel.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  }

  const abc = '<option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option>'

  it('ArrowUp activates the last option', async () => {
    const panel = await openUnselected(abc)
    await press(panel, 'ArrowUp')
    expect(activeText(panel)).toBe('Gamma')
  })

  it('ArrowDown activates the first option', async () => {
    const panel = await openUnselected(abc)
    await press(panel, 'ArrowDown')
    expect(activeText(panel)).toBe('Alpha')
  })

  it('leaves nothing active when every option is disabled', async () => {
    const panel = await openUnselected('<option value="a" disabled>Alpha</option><option value="b" disabled>Beta</option>')
    await press(panel, 'ArrowDown')
    expect(activeText(panel)).toBeUndefined()
  })
})
