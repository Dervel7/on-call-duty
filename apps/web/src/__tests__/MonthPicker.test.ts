import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import MonthPicker from '../components/ui/MonthPicker.vue'

const today = new Date()
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

let wrapper: VueWrapper | undefined

function mountPicker(props: Record<string, unknown> = {}): VueWrapper {
  wrapper?.unmount()
  wrapper = mount(MonthPicker, { props, attachTo: document.body })
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

describe('MonthPicker', () => {
  it('labels month cells with month and year and marks the selected one pressed', async () => {
    const w = mountPicker({ modelValue: '2026-08' })
    await openPicker(w)
    const cell = w.find('[data-month="2026-08"]')
    expect(cell.attributes('aria-label')).toBe('August 2026')
    expect(cell.attributes('aria-pressed')).toBe('true')
    expect(w.find('[data-month="2026-09"]').attributes('aria-pressed')).toBe('false')
  })

  it.each([
    ['picking a month', async (w: VueWrapper) => w.find('[data-month="2026-09"]').trigger('click')],
    ['Escape', async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await nextTick()
    }],
  ])('returns focus to the trigger after %s', async (_, act) => {
    const w = mountPicker({ modelValue: '2026-08' })
    await openPicker(w)
    await act(w)
    expect(document.activeElement).toBe(fieldBtn(w).element)
  })

  it('returns focus to the trigger after clearing', async () => {
    const w = mountPicker({ modelValue: '2026-08' })
    await w.find('button[aria-label="Clear month"]').trigger('click')
    expect(document.activeElement).toBe(fieldBtn(w).element)
  })

  it('opens on the current year and marks the current month', async () => {
    const w = mountPicker()
    expect(w.text()).toContain('Select month')
    await openPicker(w)
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.find('[data-year]').attributes('data-year')).toBe(String(today.getFullYear()))
    expect(w.findAll('[data-month]')).toHaveLength(12)
    expect(w.find(`[data-month="${currentMonth}"]`).exists()).toBe(true)
  })

  it('emits the picked month and closes', async () => {
    const w = mountPicker({ placeholder: 'Any month' })
    await openPicker(w)
    await w.find(`[data-month="${today.getFullYear()}-03"]`).trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[`${today.getFullYear()}-03`]])
    expect(fieldBtn(w).attributes('aria-expanded')).toBe('false')
  })

  it('opens on the selected value year and labels the trigger with that month', async () => {
    const w = mountPicker({ modelValue: '2026-08' })
    expect(fieldBtn(w).text()).toContain('August 2026')
    await openPicker(w)
    expect(w.find('[data-year]').attributes('data-year')).toBe('2026')
    await w.find('[data-month="2026-07"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['2026-07']])
  })

  it('navigates between years', async () => {
    const w = mountPicker({ modelValue: '2026-08' })
    await openPicker(w)
    await w.find('[aria-label="Next year"]').trigger('click')
    expect(w.find('[data-year]').attributes('data-year')).toBe('2027')
    await w.find('[aria-label="Previous year"]').trigger('click')
    await w.find('[aria-label="Previous year"]').trigger('click')
    expect(w.find('[data-year]').attributes('data-year')).toBe('2025')
  })

  it('clears the value', async () => {
    const w = mountPicker({ modelValue: '2026-08' })
    await w.find('button[aria-label="Clear month"]').trigger('click')
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
