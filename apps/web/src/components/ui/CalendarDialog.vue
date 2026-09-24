<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { daysInMonth } from '@oncall/utils'
import { cn } from '@/lib/utils'
import Button from './Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    modelValue: string[]
    /** Days already excluded elsewhere; shown dimmed and not selectable. */
    reservedDays?: string[]
    confirmText?: string
  }>(),
  { reservedDays: () => [], confirmText: 'Confirm' },
)
const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:modelValue': [days: string[]]
}>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const today = new Date()

const view = ref({ year: today.getFullYear(), month0: today.getMonth() })
const selected = ref<Set<string>>(new Set())
const reserved = computed(() => new Set(props.reservedDays))

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const monthLabel = computed(() =>
  monthFormat.format(new Date(view.value.year, view.value.month0, 1)),
)

interface Cell {
  iso: string
  day: number
  weekend: boolean
}

const cells = computed<(Cell | null)[]>(() => {
  const { year, month0 } = view.value
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7
  const out: (Cell | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= daysInMonth(year, month0); day++) {
    out.push({
      iso: toIso(year, month0, day),
      day,
      weekend: (lead + day - 1) % 7 >= 5,
    })
  }
  while (out.length % 7 !== 0) out.push(null)
  return out
})

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

function shiftMonth(delta: number) {
  const d = new Date(view.value.year, view.value.month0 + delta, 1)
  view.value = { year: d.getFullYear(), month0: d.getMonth() }
}

function toggle(iso: string) {
  const next = new Set(selected.value)
  if (next.has(iso)) next.delete(iso)
  else next.add(iso)
  selected.value = next
}

function close() {
  if (props.open) emit('update:open', false)
}

function confirmDays() {
  emit('update:modelValue', [...selected.value].sort())
  close()
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    selected.value = new Set(props.modelValue)
    const first = props.modelValue[0]
    if (first) {
      const d = new Date(`${first}T00:00:00`)
      view.value = { year: d.getFullYear(), month0: d.getMonth() }
    } else {
      view.value = { year: today.getFullYear(), month0: today.getMonth() }
    }
  },
)

// Capture phase + stopPropagation mirrors DatePicker: Escape closes only this
// calendar, not the enclosing dialog (which listens on window, bubble phase).
useEventListener(
  document,
  'keydown',
  (e: KeyboardEvent) => {
    if (!props.open || e.key !== 'Escape') return
    e.stopPropagation()
    close()
  },
  { capture: true },
)
</script>

<template>
  <Teleport to="body">
    <!-- data-popover-layer covers backdrop + panel: an enclosing Dialog must
         treat the entire calendar surface as "inside", so its click-outside
         handler never fires while the calendar is open. -->
    <div v-if="open" data-popover-layer class="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        class="animate-dialog-backdrop absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        @click="close"
      />
      <div
        :data-month="`${view.year}-${pad(view.month0 + 1)}`"
        role="dialog"
        :aria-label="title ?? 'Pick days'"
        class="animate-dialog-panel relative z-10 w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-pop"
      >
        <button
          type="button"
          aria-label="Close"
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 v-if="title" class="mb-3 pr-10 text-lg font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>

        <div class="flex items-center justify-between pb-2">
          <button
            type="button"
            aria-label="Previous month"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="shiftMonth(-1)"
          >
            <ChevronLeft class="size-4" />
          </button>
          <span class="text-sm font-medium text-foreground">{{ monthLabel }}</span>
          <button
            type="button"
            aria-label="Next month"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="shiftMonth(1)"
          >
            <ChevronRight class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-7">
          <span
            v-for="w in WEEKDAYS"
            :key="w"
            class="py-1 text-center text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {{ w }}
          </span>
        </div>

        <div class="grid grid-cols-7 gap-1">
          <template v-for="(c, i) in cells" :key="c?.iso ?? `blank-${i}`">
            <button
              v-if="c"
              type="button"
              :data-date="c.iso"
              :aria-pressed="selected.has(c.iso)"
              :disabled="reserved.has(c.iso)"
              :title="reserved.has(c.iso) ? 'Already excluded' : undefined"
              :class="cn(
                'flex h-9 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                selected.has(c.iso)
                  ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90'
                  : reserved.has(c.iso)
                    ? 'cursor-not-allowed bg-muted text-muted-foreground/50'
                    : c.weekend
                      ? 'text-muted-foreground hover:bg-muted'
                      : 'text-foreground hover:bg-muted',
              )"
              @click="toggle(c.iso)"
            >
              {{ c.day }}
            </button>
            <span v-else class="h-9" />
          </template>
        </div>

        <p class="mt-3 text-xs text-muted-foreground">{{ selected.size }} day(s) selected</p>

        <div class="mt-4 flex justify-end gap-2">
          <Button variant="outline" @click="close">Cancel</Button>
          <Button :disabled="selected.size === 0" @click="confirmDays">{{ confirmText }}</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
