import { describe, expect, it } from 'vitest'
import { loadSolver } from '../highs'

const OPTIONS = { output_flag: false }
const LP = 'Maximize\n obj: x\nSubject To\n c: x <= 3\nEnd\n'
const soon = (): number => Date.now() + 5_000

describe('solver worker', () => {
  it('solves LP text off the main thread', async () => {
    const solver = await loadSolver()
    const result = await solver.solve(LP, OPTIONS, soon())
    expect(result?.Status).toBe('Optimal')
    expect(result?.ObjectiveValue).toBe(3)
  })

  it('returns null when the deadline has already passed', async () => {
    const solver = await loadSolver()
    expect(await solver.solve(LP, OPTIONS, Date.now() - 1)).toBeNull()
  })

  it('retires a worker after a solver error; later requests fail fast and a fresh worker takes over', async () => {
    const broken = await loadSolver()
    // HiGHS throws on an unknown option name.
    const badOptions = { output_flag: false, no_such_option: true }
    await expect(broken.solve(LP, badOptions, soon())).rejects.toThrow()
    // A request holding the retired worker must not hang.
    await expect(broken.solve(LP, OPTIONS, soon())).rejects.toThrow(/retired/)
    const fresh = await loadSolver()
    expect(fresh).not.toBe(broken)
    expect((await fresh.solve(LP, OPTIONS, soon()))?.Status).toBe('Optimal')
  })
})
