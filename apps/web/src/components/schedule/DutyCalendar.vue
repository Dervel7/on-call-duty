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
  assignmentByDate: Map<string, CalendarAssignment[]>
  conflictsByDate: Map<string, string>
  doctors: Doctor[]
  mode: 'editable' | 'readonly'
  slotsPerDay?: number
  savingDates?: Set<string>
  pool?: 'eligible' | 'available'
  allowClear?: boolean
  showFillHints?: boolean
}>()

const SLOTS = computed(() => props.slotsPerDay ?? 2)

const emit = defineEmits<{ select: [date: string, slotIndex: number, doctorId: number | null] }>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
  isHoliday: boolean
  slots: (CalendarAssignment | undefined)[]
  conflict?: string
  options: number[][]
}

function slotOptions(eligible: number[], slots: (CalendarAssignment | undefined)[], slotIndex: number): number[] {
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
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, slots: [], options: [] })
  }
  for (const day of props.days) {
    const slotsArr = props.assignmentByDate.get(day.date) ?? []
    const slots: (CalendarAssignment | undefined)[] = Array.from({ length: SLOTS.value }, (_, i) => slotsArr[i])
    const poolIds = props.pool === 'available' ? day.availableDoctorIds : day.eligibleDoctorIds
    const options = slots.map((_, i) => slotOptions(poolIds, slots, i))
    const js = new Date(`${day.date}T00:00:00`)
    out.push({
      blank: false,
      date: day.date,
      dayNum: js.getDate(),
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      slots,
      conflict: props.conflictsByDate.get(day.date),
      options,
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, slots: [], options: [] })
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

function filledCount(slots: (CalendarAssignment | undefined)[]): number {
  return slots.filter((s) => s).length
}

function doctorFull(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.firstName} ${d.lastName}` : String(id)
}
</script>

<template>
  <div class="overflow-x-auto">
    <div class="min-w-[720px]">
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="w in WEEKDAYS"
          :key="w"
          class="bg-muted px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {{ w }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="(c, idx) in cells"
          :key="idx"
          :class="[
            'min-h-[112px] bg-card p-2',
            c.blank && 'bg-muted/40',
            !c.blank && c.isWeekend && 'bg-muted/30',
            !c.blank && c.isHoliday && 'border border-destructive/40',
            !c.blank && c.conflict && 'border border-destructive/60 bg-destructive/5',
          ]"
        >
          <template v-if="!c.blank">
            <div class="flex items-start justify-between">
              <span class="text-xs font-semibold text-foreground">{{ c.dayNum }}</span>
              <span class="flex flex-col items-end gap-0.5">
                <span
                  v-if="c.isWeekend"
                  class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >WE</span
                >
                <span
                  v-if="c.isHoliday"
                  class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                  >HOL</span
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
                    class="block text-xs font-medium text-foreground"
                    :title="doctorFull(slot.doctorId)"
                    >{{ doctorLabel(slot.doctorId) }}</span
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
                class="block text-[11px] font-medium text-amber-600"
                >1 of 2</span
              >
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
