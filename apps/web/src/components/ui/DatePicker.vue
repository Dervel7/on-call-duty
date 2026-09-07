<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, nextTick, ref } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { daysInMonth } from '@oncall/utils'
import { cn } from '@/lib/utils'

const props = defineProps<{
  id?: string
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const today = new Date()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const view = ref({ year: today.getFullYear(), month0: today.getMonth() })

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

const navBtnClass =
  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`
}

const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate())

const selectedIso = computed(() =>
  props.modelValue && /^\d{4}-\d{2}-\d{2}$/.test(props.modelValue) ? props.modelValue : '',
)

const triggerLabel = computed(() => {
  if (!selectedIso.value) return ''
  const d = new Date(`${selectedIso.value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? selectedIso.value : dayFormat.format(d)
})

const monthLabel = computed(() => monthFormat.format(new Date(view.value.year, view.value.month0, 1)))

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

function syncView() {
  if (selectedIso.value) {
    const d = new Date(`${selectedIso.value}T00:00:00`)
    view.value = { year: d.getFullYear(), month0: d.getMonth() }
  } else {
    view.value = { year: today.getFullYear(), month0: today.getMonth() }
  }
}

async function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  syncView()
  open.value = true
  await nextTick()
  panel.value?.focus()
}

function pick(iso: string) {
  emit('update:modelValue', iso)
  open.value = false
}

function clear() {
  emit('update:modelValue', '')
  open.value = false
}

function shiftMonth(delta: number) {
  const d = new Date(view.value.year, view.value.month0 + delta, 1)
  view.value = { year: d.getFullYear(), month0: d.getMonth() }
}

onClickOutside(root, () => (open.value = false))

// Capture phase + stopPropagation: Escape closes only this popover, not an
// enclosing Dialog (Dialog listens on window, bubble phase).
useEventListener(
  document,
  'keydown',
  (e: KeyboardEvent) => {
    if (!open.value || e.key !== 'Escape') return
    e.stopPropagation()
    open.value = false
  },
  { capture: true },
)
</script>

<template>
  <div ref="root" :class="cn('relative w-full', props.class)">
    <button
      :id="props.id"
      type="button"
      :disabled="props.disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :class="cn(
        'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-input/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
        selectedIso ? 'pr-9 text-foreground' : 'text-muted-foreground/70',
      )"
      @click="toggle"
    >
      <Calendar class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ triggerLabel || props.placeholder || 'Select date' }}</span>
    </button>
    <button
      v-if="selectedIso && !props.disabled"
      type="button"
      aria-label="Clear date"
      class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      @click="clear"
    >
      <X class="size-3.5" />
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="open"
        ref="panel"
        role="dialog"
        aria-label="Choose date"
        tabindex="-1"
        :data-month="`${view.year}-${pad(view.month0 + 1)}`"
        data-popover-layer
        class="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-80 rounded-xl border border-border/80 bg-popover p-3 shadow-pop focus-visible:outline-none focus-visible:shadow-none"
      >
        <div class="flex items-center justify-between pb-2">
          <button type="button" aria-label="Previous month" :class="navBtnClass" @click="shiftMonth(-1)">
            <ChevronLeft class="size-4" />
          </button>
          <span class="text-sm font-medium text-foreground">{{ monthLabel }}</span>
          <button type="button" aria-label="Next month" :class="navBtnClass" @click="shiftMonth(1)">
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
              :aria-current="c.iso === todayIso ? 'date' : undefined"
              :class="cn(
                'flex h-9 items-center justify-center rounded-md text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                c.iso === selectedIso
                  ? 'bg-primary font-medium text-primary-foreground hover:bg-primary/90'
                  : c.weekend
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                c.iso === todayIso && c.iso !== selectedIso && 'font-semibold ring-1 ring-inset ring-ring/40',
              )"
              @click="pick(c.iso)"
            >
              {{ c.day }}
            </button>
            <span v-else class="h-9" />
          </template>
        </div>

        <div class="mt-2 border-t border-border/70 pt-2">
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="view = { year: today.getFullYear(), month0: today.getMonth() }"
          >
            Today
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
