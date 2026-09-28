import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import Spinner from '../components/ui/Spinner.vue'

describe('Spinner', () => {
  it('renders an animated svg', () => {
    const wrapper = mount(Spinner)
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.classes()).toContain('animate-spin')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('defaults width and height to 16', () => {
    const wrapper = mount(Spinner)
    expect(wrapper.attributes('width')).toBe('16')
    expect(wrapper.attributes('height')).toBe('16')
  })

  it('honors the size prop', () => {
    const wrapper = mount(Spinner, { props: { size: 32 } })
    expect(wrapper.attributes('width')).toBe('32')
    expect(wrapper.attributes('height')).toBe('32')
  })
})
