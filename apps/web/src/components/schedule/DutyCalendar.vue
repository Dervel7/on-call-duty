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
  assignmentByDate: Map<string, CalendarAssignment>
  conflictsByDate: Map<string, string>
  doctors: Doctor[]
  mode: 'editable' | 'readonly'
  savingDates?: Set<string>
}>()

const emit = defineEmits<{ select: [date: string, doctorId: number | null] }>()

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
  assignment?: CalendarAssignment
  conflict?: string
  options: number[]
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  const first = props.days[0]
  if (!first) return out
  const firstJs = new Date(`${first.date}T00:00:00`)
  const lead = (firstJs.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, options: [] })
  }
  for (const day of props.days) {
    const assignment = props.assignmentByDate.get(day.date)
    const opts = new Set<number>(day.eligibleDoctorIds)
    if (assignment) opts.add(assignment.doctorId)
    const js = new Date(`${day.date}T00:00:00`)
    out.push({
      blank: false,
      date: day.date,
      dayNum: js.getDate(),
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      assignment,
      conflict: props.conflictsByDate.get(day.date),
      options: [...opts],
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, options: [] })
  }
  return out
})

function onSelect(date: string, value: string | number) {
  emit('select', date, value === '' ? null : Number(value))
}

function doctorLabel(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.lastName} ${d.firstName.charAt(0)}.` : String(id)
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
            mode === 'editable' && !c.blank && !c.assignment && c.options.length > 0 && 'border border-dashed border-primary/40',
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

            <div class="mt-1.5">
              <template v-if="mode === 'editable' && !c.conflict">
                <Select
                  :model-value="c.assignment ? String(c.assignment.doctorId) : ''"
                  :disabled="savingDates?.has(c.date ?? '')"
                  @update:model-value="onSelect(c.date!, $event)"
                >
                  <option value="" :disabled="!c.assignment">
                    {{ c.assignment ? 'Unassigned' : 'Assign…' }}
                  </option>
                  <option v-for="did in c.options" :key="did" :value="String(did)">
                    {{ doctorLabel(did) }}
                  </option>
                </Select>
              </template>
              <template v-else>
                <span
                  v-if="c.assignment"
                  class="block text-xs font-medium text-foreground"
                  :title="doctorFull(c.assignment.doctorId)"
                  >{{ doctorLabel(c.assignment.doctorId) }}</span
                >
                <span v-else-if="c.conflict" class="block text-[11px] font-medium text-destructive" :title="c.conflict"
                  >Unfillable</span
                >
                <span v-else class="block text-xs italic text-muted-foreground">—</span>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
