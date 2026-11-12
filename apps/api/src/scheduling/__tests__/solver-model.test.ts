import { describe, expect, it } from 'vitest'
import { loadSolver } from '../highs.ts'
import { buildModel, indexModel, type Stage } from '../solver-model.ts'
import { ctx, day, dr } from './helpers.ts'

// Tue 1, Wed 2, Thu 3 September 2026; anchor 09-01 every 2 days: 1 and 3 are
// open, 2 is the day after an open day. Doctor 2 is away on the 2nd, doctor 3
// held the previous month's last day.
const model = indexModel(
  ctx([day('2026-09-01'), day('2026-09-02'), day('2026-09-03')], [dr(3), dr(1), dr(2)], {
    unavailability: new Map([[2, [{ start: '2026-09-02', end: '2026-09-02' }]]]),
    priorDayDoctorIds: new Set([3]),
    openDuty: { anchorDate: '2026-09-01', intervalDays: 2 },
  }),
)
const lp = buildModel(model, 'fill', { optima: new Map(), capacity: new Map() }) ?? ''
const variables = new Set(lp.match(/\bx_\d+_\d{8}\b/g))

/** Solves LP text and returns the objective value plus the cells set to 1. */
async function solve(text: string): Promise<{ objective: number; chosen: Set<string> }> {
  const solver = await loadSolver()
  const result = await solver.solve(text, { output_flag: false }, Date.now() + 10_000)
  expect(result?.Status).toBe('Optimal')
  const chosen = new Set<string>()
  for (const [name, column] of Object.entries(result?.Columns ?? {})) {
    if ('Primal' in column && column.Primal > 0.5 && variables.has(name)) chosen.add(name)
  }
  return { objective: result?.ObjectiveValue ?? NaN, chosen }
}

describe('solver model', () => {
  it('has a variable only where the doctor may be assigned', () => {
    expect([...variables].sort()).toEqual([
      'x_1_20260901',
      'x_1_20260902',
      'x_1_20260903',
      'x_2_20260901',
      'x_2_20260903',
      'x_3_20260902',
      'x_3_20260903',
    ])
  })

  it('gives no last-day variable to a doctor who holds the next month first day', () => {
    const edge = indexModel(
      ctx([day('2026-09-29'), day('2026-09-30')], [dr(1), dr(2)], { nextDayDoctorIds: new Set([1]) }),
    )
    expect((edge.cellsByDate.get('2026-09-30') ?? []).map((c) => c.doctorId)).toEqual([2])
  })

  it('never lets one doctor hold back-to-back days or two open on-call days', async () => {
    const { chosen } = await solve(buildModel(model, 'capacity', { optima: new Map(), capacity: new Map() }) ?? '')
    const both = (a: string, b: string): boolean => chosen.has(a) && chosen.has(b)
    expect(both('x_1_20260901', 'x_1_20260902')).toBe(false)
    expect(both('x_1_20260902', 'x_1_20260903')).toBe(false)
    expect(both('x_1_20260901', 'x_1_20260903')).toBe(false)
    expect(both('x_2_20260901', 'x_2_20260903')).toBe(false)
    // Without the rules every cell would be chosen; with them some must be dropped.
    expect(chosen.size).toBeLessThan(variables.size)
  })

  it('skips a stage with nothing to optimize', () => {
    // No Friday, Saturday or Sunday in the month.
    expect(buildModel(model, 'weekdays', { optima: new Map(), capacity: new Map() })).toBeNull()
  })

  describe('alternative stage', () => {
    // Runs the capacity stage and every objective stage the way the solver
    // does, so the bounds the alternative keeps are the real optima.
    async function primary(): Promise<{ optima: Map<Stage, number>; capacity: Map<number, number>; first: Set<string> }> {
      const optima = new Map<Stage, number>()
      const capacity = new Map<number, number>()
      let first = new Set<string>()
      for (const stage of model.stages) {
        const text = buildModel(model, stage, { optima, capacity })
        if (!text) continue
        const { objective, chosen } = await solve(text)
        if (stage === 'capacity') {
          for (const [id, cells] of model.cellsByDoctor) {
            capacity.set(id, cells.filter((c) => chosen.has(c.name)).length)
          }
          continue
        }
        optima.set(stage, Math.round(objective))
        first = chosen
      }
      return { optima, capacity, first }
    }

    it('keeps the fill optimum and excludes the earlier option', async () => {
      const { optima, capacity, first } = await primary()
      const text = buildModel(model, 'alternative', { optima, capacity, avoid: [first] }) ?? ''
      const { chosen } = await solve(text)
      expect(chosen.size).toBeGreaterThanOrEqual(optima.get('fill') ?? Infinity)
      expect([...first].every((name) => chosen.has(name))).toBe(false)
    })

    it('counts a duty once per earlier option that holds it', async () => {
      const { optima, capacity, first } = await primary()
      const secondText = buildModel(model, 'alternative', { optima, capacity, avoid: [first] }) ?? ''
      const second = (await solve(secondText)).chosen
      const text = buildModel(model, 'alternative', { optima, capacity, avoid: [first, second] }) ?? ''
      const { objective, chosen } = await solve(text)
      let shared = 0
      for (const name of chosen) shared += Number(first.has(name)) + Number(second.has(name))
      expect(objective).toBe(shared)
      expect([...first].every((name) => chosen.has(name))).toBe(false)
      expect([...second].every((name) => chosen.has(name))).toBe(false)
    })

    it('has nothing to optimize without an earlier option', () => {
      expect(buildModel(model, 'alternative', { optima: new Map(), capacity: new Map() })).toBeNull()
    })
  })
})
