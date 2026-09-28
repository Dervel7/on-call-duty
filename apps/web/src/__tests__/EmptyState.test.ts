import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import EmptyState from '../components/ui/EmptyState.vue'

describe('EmptyState', () => {
  it('renders title and description', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Nothing here', description: 'Try creating something' },
    })
    expect(wrapper.text()).toContain('Nothing here')
    expect(wrapper.text()).toContain('Try creating something')
  })

  it('renders the default Inbox icon', () => {
    const wrapper = mount(EmptyState, { props: { title: 'Empty' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.grid > svg').classes()).toContain('h-6')
  })

  it('renders an action via the default slot', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'Empty' },
      slots: { default: '<button type="button">New item</button>' },
    })
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.find('button').text()).toBe('New item')
  })
})
