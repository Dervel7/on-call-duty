import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import Badge from '../components/ui/Badge.vue'

describe('Badge', () => {
  it('defaults to the neutral variant', () => {
    const wrapper = mount(Badge, { slots: { default: 'Active' } })
    expect(wrapper.classes()).toContain('bg-muted')
    expect(wrapper.classes()).toContain('text-muted-foreground')
    expect(wrapper.text()).toBe('Active')
  })

  it.each([
    ['primary', 'bg-primary/10'],
    ['success', 'bg-success/10'],
    ['warning', 'bg-warning/10'],
    ['destructive', 'bg-destructive/10'],
    ['accent', 'bg-accent/10'],
    ['outline', 'border'],
  ] as const)('maps the %s variant to its class', (variant, expected) => {
    const wrapper = mount(Badge, { props: { variant }, slots: { default: 'X' } })
    expect(wrapper.classes()).toContain(expected)
  })

  it('renders a dot span when dot is set', () => {
    const wrapper = mount(Badge, { props: { dot: true }, slots: { default: 'Active' } })
    const dot = wrapper.find('span > span')
    expect(dot.exists()).toBe(true)
    expect(dot.attributes('aria-hidden')).toBe('true')
    expect(dot.classes()).toContain('bg-current')
  })

  it('renders no dot span by default', () => {
    const wrapper = mount(Badge, { slots: { default: 'Active' } })
    expect(wrapper.findAll('span')).toHaveLength(1)
  })
})
