import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HomePage from '../pages/HomePage.vue'

describe('HomePage', () => {
  it('renders the title', () => {
    const wrapper = mount(HomePage)
    expect(wrapper.text()).toContain('On-Call Duty')
  })
})
