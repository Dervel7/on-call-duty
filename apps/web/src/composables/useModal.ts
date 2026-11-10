import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Number of open modals across all instances; body scrolling is restored only
// when the last one closes, so closing the top of a stack keeps the lock.
let scrollLocks = 0

/**
 * Shared modal behavior for Dialog and CalendarDialog: body scroll lock,
 * initial focus, Tab/Shift+Tab trap inside `panel`, and focus restore on close
 * or unmount.
 */
export function useModal(open: () => boolean, panel: Ref<HTMLElement | null>) {
  let locked = false
  let returnFocus: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    return Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      // Skip controls hidden by responsive classes; jsdom has no checkVisibility, so treat all as visible there.
      (el) => el.checkVisibility?.({ visibilityProperty: true }) ?? true,
    )
  }

  async function activate() {
    if (!locked) {
      locked = true
      if (scrollLocks++ === 0) document.body.style.overflow = 'hidden'
    }
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    // A consumer (e.g. ConfirmDialog) may already have placed focus inside the
    // panel; keep its explicit choice instead of overriding it.
    if (panel.value?.contains(document.activeElement)) return
    ;(focusables()[0] ?? panel.value)?.focus()
  }

  function release() {
    if (locked) {
      locked = false
      if (--scrollLocks === 0) document.body.style.overflow = ''
    }
    const target = returnFocus
    returnFocus = null
    if (target?.isConnected) target.focus()
  }

  watch(open, (v) => (v ? activate() : release()), { immediate: true })
  onBeforeUnmount(release)

  useEventListener(panel, 'keydown', (e: KeyboardEvent) => {
    // The panel may stay mounted while closed (the docked sidebar): only trap while open.
    if (e.key !== 'Tab' || !open()) return
    const items = focusables()
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) {
      e.preventDefault()
      return
    }
    const current = document.activeElement
    if (e.shiftKey && (current === first || !panel.value?.contains(current))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || !panel.value?.contains(current))) {
      e.preventDefault()
      first.focus()
    }
  })
}
