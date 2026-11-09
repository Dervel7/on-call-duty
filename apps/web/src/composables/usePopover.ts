import { nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

const GAP = 6

interface PopoverOptions {
  root: Readonly<Ref<HTMLElement | null>>
  trigger: Readonly<Ref<HTMLElement | null>>
  /** Teleported, fixed-positioned panel; it counts as "inside" despite living in <body>. */
  panel: Readonly<Ref<HTMLElement | null>>
  /** Size the panel to the trigger (at least `minWidth`) and cap its height to the free space. */
  matchTrigger?: { minWidth: number }
  /** Minimum distance kept to the viewport edges. */
  margin?: number
}

/**
 * Shared behaviour of the teleported popovers (Select, DatePicker, MonthPicker):
 * open/close with focus handling, viewport-clamped positioning, and dismissal
 * by outside click, scroll, Escape and Tab.
 */
export function usePopover({ root, trigger, panel, matchTrigger, margin = 8 }: PopoverOptions) {
  const open = ref(false)

  function positionPanel() {
    const btn = trigger.value
    const p = panel.value
    if (!btn || !p) return
    const r = btn.getBoundingClientRect()
    let width = p.offsetWidth
    if (matchTrigger) {
      width = Math.max(r.width, matchTrigger.minWidth)
      p.style.width = `${width}px`
    }
    p.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))}px`
    // Clear the previous open's constraints so scrollHeight measures the full
    // content height before the direction is decided.
    p.style.maxHeight = ''
    p.style.top = ''
    p.style.bottom = ''
    const spaceBelow = window.innerHeight - r.bottom - margin
    const spaceAbove = r.top - margin
    // Flip above the trigger when the content does not fit below and there is more room above.
    const flip = p.scrollHeight > spaceBelow - GAP && spaceAbove > spaceBelow
    if (flip) p.style.bottom = `${window.innerHeight - r.top + GAP}px`
    else p.style.top = `${r.bottom + GAP}px`
    if (matchTrigger) p.style.maxHeight = `${Math.max(180, flip ? spaceAbove : spaceBelow)}px`
  }

  async function toggle(beforeOpen?: () => void) {
    if (open.value) {
      open.value = false
      return
    }
    beforeOpen?.()
    open.value = true
    await nextTick()
    positionPanel()
    panel.value?.focus()
  }

  // The panel is teleported to body and removed on close, so focus must be moved
  // back to the trigger explicitly or it falls to body (and out of any Dialog).
  function close() {
    open.value = false
    trigger.value?.focus()
  }

  // Closes back to the trigger when Tab would leave the panel; the default Tab
  // then continues from the trigger instead of from the end of the document.
  function onPanelKeydown(e: KeyboardEvent) {
    const p = panel.value
    if (e.key !== 'Tab' || !p) return
    const items = p.querySelectorAll<HTMLElement>('button:not([disabled])')
    const active = document.activeElement
    const leaving = e.shiftKey ? active === p || active === items[0] : active === items[items.length - 1]
    if (leaving) close()
  }

  // Capture phase + stopPropagation: the dismissing click must not also activate
  // what is underneath (e.g. the backdrop of an enclosing Dialog).
  useEventListener(
    document,
    'click',
    (e: MouseEvent) => {
      if (!open.value) return
      const target = e.target as Node
      if (root.value?.contains(target) || panel.value?.contains(target)) return
      open.value = false
      e.stopPropagation()
    },
    { capture: true },
  )

  // The panel is fixed-positioned; a scroll outside it would misplace it.
  useEventListener(
    window,
    'scroll',
    (e: Event) => {
      if (!open.value || panel.value?.contains(e.target as Node)) return
      open.value = false
    },
    { capture: true, passive: true },
  )

  // Escape closes only this popover, not an enclosing Dialog (which listens on
  // window, bubble phase).
  useEventListener(
    document,
    'keydown',
    (e: KeyboardEvent) => {
      if (!open.value || e.key !== 'Escape') return
      e.stopPropagation()
      close()
    },
    { capture: true },
  )

  return { open, toggle, close, onPanelKeydown }
}
