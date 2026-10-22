import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import type { LegacyHighsOptions, LegacyHighsSolution } from 'highs'

/** HiGHS behind an async boundary, so a long solve never blocks the API. */
export interface Solver {
  /**
   * Solves CPLEX LP text. The time limit is whatever is left until `deadline`
   * (epoch ms) when the solve starts; null when nothing is left.
   */
  solve(lp: string, options: LegacyHighsOptions, deadline: number): Promise<LegacyHighsSolution | null>
}

/** Supplies the solver; tests inject a failing one to exercise the fallback. */
export type SolverLoader = () => Promise<Solver>

/**
 * Extra wait past the deadline before a silent worker is treated as stuck.
 * HiGHS checks its time limit while solving; this only guards against a
 * solve that never returns.
 */
const STUCK_GRACE_MS = 5_000

/**
 * Idle time after which the worker is retired. HiGHS memory grows to fit the
 * largest model solved and never shrinks (over 200 MB for a 60-doctor clinic),
 * so an idle worker would hold it for the life of the process.
 */
export const SOLVER_IDLE_MS = 60_000

/**
 * Worker body, plain CommonJS so it runs unchanged under Node, Vitest and the
 * compiled build. It receives one request at a time.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const loading = require(workerData.highsPath)()
parentPort.on('message', async ({ lp, options, deadline }) => {
  try {
    const highs = await loading
    const remaining = deadline - Date.now()
    const result = remaining > 0 ? highs.solve(lp, { ...options, time_limit: remaining / 1000 }) : null
    parentPort.postMessage({ result })
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
`

interface Reply {
  result?: LegacyHighsSolution | null
  error?: string
}

interface Job {
  lp: string
  options: LegacyHighsOptions
  deadline: number
  resolve: (result: LegacyHighsSolution | null) => void
  reject: (error: Error) => void
}

let current: { worker: Worker; solver: Solver } | null = null
/** Termination of the last retired worker; a new one waits for it so two HiGHS heaps never coexist. */
let retiring: Promise<number> = Promise.resolve(0)

/**
 * One worker, one solve at a time. Requests wait in a FIFO queue here rather
 * than in the worker, so the stuck-worker watchdog only counts the running
 * solve, and a request whose deadline passes while queued never reaches it.
 */
function startWorker(): { worker: Worker; solver: Solver } {
  const highsPath = createRequire(import.meta.url).resolve('highs')
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { highsPath } })
  const queue: Job[] = []
  let running: { job: Job; watchdog: NodeJS.Timeout } | null = null
  let stopped: Error | null = null
  let idle: NodeJS.Timeout | undefined
  // An idle worker must not keep the process alive; a busy one must.
  worker.unref()

  /** Rejects every open request and retires this worker for good. */
  const stop = (error: Error): void => {
    if (stopped) return
    stopped = error
    clearTimeout(idle)
    if (running) {
      clearTimeout(running.watchdog)
      running.job.reject(error)
      running = null
    }
    for (const job of queue.splice(0)) job.reject(error)
    if (current?.worker === worker) current = null
    retiring = worker.terminate()
  }

  const dispatch = (): void => {
    while (!running && !stopped) {
      const job = queue.shift()
      if (!job) {
        worker.unref()
        idle = setTimeout(() => stop(new Error('solver worker retired after idle')), SOLVER_IDLE_MS)
        idle.unref()
        return
      }
      const remaining = job.deadline - Date.now()
      if (remaining <= 0) {
        job.resolve(null)
        continue
      }
      const watchdog = setTimeout(
        () => stop(new Error('solver worker did not answer in time')),
        remaining + STUCK_GRACE_MS,
      )
      watchdog.unref()
      running = { job, watchdog }
      worker.ref()
      worker.postMessage({ lp: job.lp, options: job.options, deadline: job.deadline })
    }
  }

  worker.on('message', (reply: Reply) => {
    if (!running) return
    const { job, watchdog } = running
    clearTimeout(watchdog)
    running = null
    if (reply.error === undefined) {
      job.resolve(reply.result ?? null)
      dispatch()
      return
    }
    // HiGHS threw inside WebAssembly: the instance may be corrupt, so the
    // next request gets a fresh worker.
    job.reject(new Error(reply.error))
    stop(new Error(`solver worker retired after an error: ${reply.error}`))
  })
  worker.on('error', stop)
  worker.on('exit', (code) => stop(new Error(`solver worker exited with code ${code}`)))

  const solver: Solver = {
    solve(lp, options, deadline) {
      return new Promise((resolve, reject) => {
        if (stopped) {
          reject(stopped)
          return
        }
        clearTimeout(idle)
        queue.push({ lp, options, deadline, resolve, reject })
        dispatch()
      })
    },
  }
  return { worker, solver }
}

/**
 * Starts the solver worker on demand and reuses it until it is retired. A
 * caller must not hold a solver longer than SOLVER_IDLE_MS between solves.
 */
export const loadSolver: SolverLoader = async () => {
  if (!current) await retiring
  current ??= startWorker()
  return current.solver
}
