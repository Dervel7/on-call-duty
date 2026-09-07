import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import DatePicker from '../components/ui/DatePicker.vue'

const today = new Date()
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

function monthOf(offset: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

let wrapper: VueWrapper | undefined

function mountPicker(props: Record<string, unknown> = {}): VueWrapper {
  wrapper?.unmount()
  wrapper = mount(DatePicker, { props, attachTo: document.body })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function fieldBtn(w: VueWrapper) {
  return w.find('button[aria-haspopup="dialog"]')
}

async function openPicker(w: VueWrapper) {
  await fieldBtn(w).trigger('click')
}

describe('DatePicker', () => {
  it('opens on the current month and marks today', async () => {
    const w = mountPicker()
    expect(w.text()).toContain('Select date')
    await openPicker(w)
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.find('[data-month]').attributes('data-month')).toBe(monthOf(0))
    expect(w.find('[aria-current="date"]').attributes('data-date')).toBe(todayIso)
  })

  it('emits the picked ISO date and closes', async () => {
    const w = mountPicker({ placeholder: 'Pick a date' })
    await openPicker(w)
    await w.find(`[data-date="${todayIso}"]`).trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[todayIso]])
    expect(fieldBtn(w).attributes('aria-expanded')).toBe('false')
  })

  it('opens on the selected value month and can change the value', async () => {
    const w = mountPicker({ modelValue: '2026-08-15' })
    expect(fieldBtn(w).text()).toContain('15 Aug 2026')
    await openPicker(w)
    expect(w.find('[data-month]').attributes('data-month')).toBe('2026-08')
    await w.find('[data-date="2026-08-20"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['2026-08-20']])
  })

  it('navigates between months', async () => {
    const w = mountPicker()
    await openPicker(w)
    await w.find('[aria-label="Next month"]').trigger('click')
    expect(w.find('[data-month]').attributes('data-month')).toBe(monthOf(1))
    await w.find('[aria-label="Previous month"]').trigger('click')
    await w.find('[aria-label="Previous month"]').trigger('click')
    expect(w.find('[data-month]').attributes('data-month')).toBe(monthOf(-1))
  })

  it('jumps to today from the footer shortcut', async () => {
    const w = mountPicker()
    await openPicker(w)
    await w.find('[aria-label="Next month"]').trigger('click')
    await w.find('[role="dialog"] button:not([data-date]):not([aria-label])').trigger('click')
    expect(w.find('[data-month]').attributes('data-month')).toBe(monthOf(0))
  })

  it('clears the value', async () => {
    const w = mountPicker({ modelValue: todayIso })
    await w.find('button[aria-label="Clear date"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['']])
  })

  it('closes on Escape without propagating to window listeners', async () => {
    const w = mountPicker()
    await openPicker(w)
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(fieldBtn(w).attributes('aria-expanded')).toBe('false')
    expect(spy).not.toHaveBeenCalled()
    window.removeEventListener('keydown', spy)
  })
})
