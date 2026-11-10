import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useEstimatedProgress } from '@/composables/useEstimatedProgress'

function setup(estimateMs: number) {
  const scope = effectScope()
  const bar = scope.run(() => useEstimatedProgress(estimateMs))!
  return { scope, bar }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useEstimatedProgress', () => {
  it('follows the estimate, then holds at 95% while the request is pending', async () => {
    const { bar } = setup(10_000)
    bar.start()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(bar.progress.value).toBe(15)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(bar.progress.value).toBe(95)
  })

  it('finish fills to 100% at 14x speed and resolves only when full', async () => {
    const { bar } = setup(10_000)
    bar.start()
    await vi.advanceTimersByTimeAsync(1_500)
    let done = false
    void bar.finish().then(() => (done = true))

    // The remaining 85% takes 7 ticks of 14%, not 85 ticks of 1%.
    await vi.advanceTimersByTimeAsync(500)
    expect(bar.progress.value).toBe(85)
    expect(done).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    expect(bar.progress.value).toBe(100)
    expect(done).toBe(true)
  })

  it('stops ticking when its scope is disposed', async () => {
    const { scope, bar } = setup(10_000)
    bar.start()
    await vi.advanceTimersByTimeAsync(500)
    scope.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(bar.progress.value).toBe(5)
  })
})
