import { describe, expect, it } from 'vitest'
import { useLatestRequest } from '@/composables/useLatestRequest'

describe('useLatestRequest', () => {
  it('only the most recent start stays current', () => {
    const latest = useLatestRequest()
    const first = latest.start()
    expect(first()).toBe(true)
    const second = latest.start()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('separate instances do not affect each other', () => {
    const a = useLatestRequest().start()
    useLatestRequest().start()
    expect(a()).toBe(true)
  })
})
