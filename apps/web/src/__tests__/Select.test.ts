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
