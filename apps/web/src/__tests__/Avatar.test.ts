import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import Avatar from '../components/ui/Avatar.vue'

describe('Avatar', () => {
  it('renders initials from the first two words', () => {
    const wrapper = mount(Avatar, { props: { name: 'Jane Roe' } })
    expect(wrapper.text()).toBe('JR')
  })

  it('uses a single initial for a single word', () => {
    const wrapper = mount(Avatar, { props: { name: 'Plato' } })
    expect(wrapper.text()).toBe('P')
  })

  it('assigns the same palette class for the same name', () => {
    const a = mount(Avatar, { props: { name: 'Jane Roe' } })
    const b = mount(Avatar, { props: { name: 'Jane Roe' } })
    const aPalette = a.classes().find((c) => c.includes('-500/15'))
    const bPalette = b.classes().find((c) => c.includes('-500/15'))
    expect(aPalette).toBeTruthy()
    expect(aPalette).toBe(bPalette)
  })

  it('is deterministic: the palette class matches the char-code hue rule', () => {
    const PALETTE_HUES = ['violet', 'sky', 'emerald', 'amber', 'rose', 'teal', 'indigo', 'fuchsia']
    const name = 'Ada Lovelace'
    const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE_HUES.length
    const wrapper = mount(Avatar, { props: { name } })
    expect(wrapper.classes()).toContain(`bg-${PALETTE_HUES[hue]}-500/15`)
  })

  it.each([
    ['sm', 'h-7'],
    ['md', 'h-9'],
    ['lg', 'h-12'],
  ] as const)('maps size %s to its height class', (size, expected) => {
    const wrapper = mount(Avatar, { props: { name: 'Jane Roe', size } })
    expect(wrapper.classes()).toContain(expected)
  })

  it('defaults to the md size', () => {
    const wrapper = mount(Avatar, { props: { name: 'Jane Roe' } })
    expect(wrapper.classes()).toContain('h-9')
  })
})
