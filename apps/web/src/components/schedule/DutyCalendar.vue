<script setup lang="ts">
import { computed } from 'vue'
import type { DayInfo, Doctor } from '@oncall/shared'
import Select from '@/components/ui/Select.vue'

interface CalendarAssignment {
  doctorId: number
  firstName: string
  lastName: string
  reason: string
}

const props = defineProps<{
  year: number
  month: number
  days: DayInfo[]
  assignmentByDate: Map<string, (CalendarAssignment | null)[]>
  conflictsByDate: Map<string, string>
  doctors: Doctor[]
  mode: 'editable' | 'readonly'
  savingDates?: Set<string>
  pool?: 'eligible' | 'available'
  allowClear?: boolean
  showFillHints?: boolean
}>()

const emit = defineEmits<{ select: [date: string, slotIndex: number, doctorId: number | null] }>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const todayIso = new Date().toISOString().slice(0, 10)

const doctorsById = computed(() => {
  const m = new Map<number, Doctor>()
  for (const d of props.doctors) m.set(d.id, d)
  return m
})

interface Cell {
  blank: boolean
  date: string | null
  dayNum: number | null
  isWeekend: boolean
  isToday: boolean
  isOpen: boolean
  /** The day's configured on-call capacity (open vs closed count). */
  required: number
  slots: (CalendarAssignment | null)[]
  conflict?: string
  options: number[][]
}

function slotOptions(eligible: number[], slots: (CalendarAssignment | null)[], slotIndex: number): number[] {
  const taken = new Set<number>()
  slots.forEach((s, i) => {
    if (i !== slotIndex && s) taken.add(s.doctorId)
  })
  const opts = new Set<number>(eligible)
  const current = slots[slotIndex]
  if (current) opts.add(current.doctorId)
  return [...opts].filter((id) => !taken.has(id))
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  const first = props.days[0]
  if (!first) return out
  const firstJs = new Date(`${first.date}T00:00:00`)
  const lead = (firstJs.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isToday: false, isOpen: false, required: 0, slots: [], options: [] })
  }
  for (const day of props.days) {
    const required = day.slotsRequired
    const slotsArr = props.assignmentByDate.get(day.date) ?? []
    const slots: (CalendarAssignment | null)[] = Array.from({ length: required }, (_, i) => slotsArr[i] ?? null)
    const poolIds = props.pool === 'available' ? day.availableDoctorIds : day.eligibleDoctorIds
    const options = slots.map((_, i) => slotOptions(poolIds, slots, i))
    const js = new Date(`${day.date}T00:00:00`)
    out.push({
      blank: false,
      date: day.date,
      dayNum: js.getDate(),
      isWeekend: day.isWeekend,
      isToday: day.date === todayIso,
      isOpen: day.dutyType === 'open',
      required,
      slots,
      conflict: props.conflictsByDate.get(day.date),
      options,
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isToday: false, isOpen: false, required: 0, slots: [], options: [] })
  }
  return out
})

function onSelect(date: string, slotIndex: number, value: string | number) {
  emit('select', date, slotIndex, value === '' ? null : Number(value))
}

function doctorLabel(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.lastName} ${d.firstName.charAt(0)}.` : String(id)
}

function slotLabel(slot: CalendarAssignment): string {
  return `${slot.lastName} ${slot.firstName.charAt(0)}.`
}

function slotFull(slot: CalendarAssignment): string {
  return `${slot.firstName} ${slot.lastName}`
}

function filledCount(slots: (CalendarAssignment | null)[]): number {
  return slots.filter((s) => s).length
}

function cellBg(c: Cell): string {
  if (c.blank) return 'border-transparent bg-transparent'
  // Open on-call days always carry the red border, above every other cue; the
  // fill/conflict background underneath keeps coverage readable.
  if (c.isOpen) {
    if (props.showFillHints) {
      const n = filledCount(c.slots)
      if (n >= c.required) return 'border-2 border-destructive bg-success/10'
      if (n === 0) return 'border-2 border-destructive bg-destructive/10'
      return 'border-2 border-destructive bg-warning/10'
    }
    if (c.conflict) return 'border-2 border-destructive bg-destructive/5'
    if (c.isWeekend) return 'border-2 border-destructive bg-muted/40'
    return 'border-2 border-destructive bg-card'
  }
  if (props.showFillHints) {
    const n = filledCount(c.slots)
    if (n >= c.required) return 'border-success/25 bg-success/10'
    if (n === 0) return 'border-destructive/25 bg-destructive/10'
    return 'border-warning/30 bg-warning/10'
  }
  if (c.conflict) return 'border-destructive/40 bg-destructive/5'
  if (c.isWeekend) return 'border-border/60 bg-muted/40'
  return 'border-border/60 bg-card'
}
</script>

<template>
  <div class="overflow-x-auto">
    <div class="relative min-w-[760px] rounded-xl border border-border/60 bg-card/50 p-2 shadow-card backdrop-blur-sm">
      <div class="grid grid-cols-7 gap-1.5">
        <div
          v-for="w in WEEKDAYS"
          :key="w"
          class="rounded-md bg-muted/50 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80"
        >
          {{ w }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-1.5">
        <div
          v-for="(c, idx) in cells"
          :key="idx"
          :class="[
            'min-h-[112px] rounded-lg border p-2 transition-colors',
            cellBg(c),
          ]"
        >
          <template v-if="!c.blank">
            <!-- Fixed height = both badges stacked (WE + OPEN), so the slots
                 start at the same place in every day cell. -->
            <div class="flex h-[34px] items-start justify-between">
              <span v-if="c.isToday" class="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-glow">{{ c.dayNum }}</span>
              <span v-else-if="c.isWeekend" class="font-mono text-xs font-bold text-primary">{{ c.dayNum }}</span>
              <span v-else class="font-mono text-xs font-bold">{{ c.dayNum }}</span>
              <span class="flex flex-col items-end gap-0.5">
                <span
                  v-if="c.isWeekend"
                  class="inline-flex rounded bg-primary/10 px-1.5 py-[3px] text-[10px] leading-none font-medium text-primary"
                  >WE</span
                >
                <span
                  v-if="c.isOpen"
                  class="inline-flex rounded bg-destructive/10 px-1.5 py-[3px] text-[10px] leading-none font-medium text-destructive"
                  >OPEN</span
                >
              </span>
            </div>

            <div class="mt-1.5 flex flex-col gap-1">
              <div v-for="(slot, sIdx) in c.slots" :key="sIdx">
                <template v-if="mode === 'editable'">
                  <Select
                    :model-value="slot ? String(slot.doctorId) : ''"
                    :disabled="savingDates?.has(c.date ?? '')"
                    @update:model-value="onSelect(c.date!, sIdx, $event)"
                  >
                    <option value="" :disabled="!!slot && !allowClear">
                      {{ slot ? 'Unassigned' : 'Assign…' }}
                    </option>
                    <option v-for="did in c.options[sIdx]" :key="did" :value="String(did)">
                      {{ doctorLabel(did) }}
                    </option>
                  </Select>
                </template>
                <template v-else>
                  <span
                    v-if="slot"
                    class="inline-flex max-w-full items-center rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px]"
                    :title="slotFull(slot)"
                    >{{ slotLabel(slot) }}</span
                  >
                  <span v-else class="block text-xs italic text-muted-foreground">—</span>
                </template>
              </div>
              <span
                v-if="mode !== 'editable' && c.conflict && !c.slots.some((s) => s)"
                class="block text-[11px] font-medium text-destructive"
                :title="c.conflict"
                >Unfillable</span
              >
              <span
                v-if="mode === 'editable' && showFillHints && filledCount(c.slots) === 0"
                class="block text-[11px] font-medium text-destructive"
                :title="c.conflict"
                >No doctor</span
              >
              <span
                v-else-if="mode === 'editable' && showFillHints && filledCount(c.slots) === 1"
                class="block text-[11px] font-medium text-warning"
                >1 of 2</span
              >
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
