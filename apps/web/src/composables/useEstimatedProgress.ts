import { onScopeDispose, ref, type Ref } from 'vue'

const PROGRESS_HOLD = 95
const PROGRESS_TICK_MS = 100
const FINISH_SPEED = 8

export interface EstimatedProgress {
  /** Whole percent, 0-100. */
  progress: Ref<number>
  start: () => void
  /** Fills the bar to 100%; resolves when it gets there. */
  finish: () => Promise<void>
  stop: () => void
}

// The request reports no progress, so the bar is a time-based estimate. It holds
// below 100% until the response arrives, then fills to 100% at 8x speed so it never jumps.
export function useEstimatedProgress(estimateMs: number): EstimatedProgress {
  const progress = ref(0)
  let filled = 0
  let speed = 1
  let timer: ReturnType<typeof setInterval> | undefined
  let onFilled: (() => void) | undefined

  function start() {
    stop()
    filled = 0
    speed = 1
    onFilled = undefined
    progress.value = 0
    timer = setInterval(() => {
      const step = (speed * PROGRESS_TICK_MS * 100) / estimateMs
      filled = Math.min(speed > 1 ? 100 : PROGRESS_HOLD, filled + step)
      progress.value = Math.round(filled)
      if (filled === 100) {
        stop()
        onFilled?.()
      }
    }, PROGRESS_TICK_MS)
  }

  function finish(): Promise<void> {
    speed = FINISH_SPEED
    return new Promise((resolve) => (onFilled = resolve))
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  onScopeDispose(stop)
  return { progress, start, finish, stop }
}
