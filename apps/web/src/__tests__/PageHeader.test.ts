import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { CalendarDays } from 'lucide-vue-next'

import PageHeader from '../components/ui/PageHeader.vue'

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    const wrapper = mount(PageHeader, { props: { title: 'Schedule', subtitle: 'Who is on call' } })
    expect(wrapper.find('h1').text()).toBe('Schedule')
    expect(wrapper.find('p').text()).toBe('Who is on call')
  })

  it('renders actions slot content', () => {
    const wrapper = mount(PageHeader, {
      props: { title: 'Schedule' },
      slots: { actions: '<button type="button">Add</button>' },
    })
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.find('button').text()).toBe('Add')
  })

  it('shows the icon wrapper when an icon is given', () => {
    const wrapper = mount(PageHeader, { props: { title: 'Schedule', icon: CalendarDays } })
    const iconWrapper = wrapper.find('span.grid')
    expect(iconWrapper.exists()).toBe(true)
    expect(iconWrapper.classes()).toContain('bg-primary/10')
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('hides the icon wrapper when no icon is given', () => {
    const wrapper = mount(PageHeader, { props: { title: 'Schedule' } })
    expect(wrapper.find('span').exists()).toBe(false)
  })

  it('omits the subtitle element when no subtitle is given', () => {
    const wrapper = mount(PageHeader, { props: { title: 'Schedule' } })
    expect(wrapper.find('p').exists()).toBe(false)
  })
})