<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, nextTick, ref } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { MONTHS, monthLabel, toIsoMonth } from '@oncall/utils'
import { cn } from '@/lib/utils'

const props = defineProps<{
  id?: string
  /** Selected month as 'YYYY-MM'; empty string means no month selected. */
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const today = new Date()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const year = ref(today.getFullYear())

const navBtnClass =
  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

const selectedMonth = computed(() =>
  props.modelValue && /^\d{4}-\d{2}$/.test(props.modelValue) ? props.modelValue : '',
)

const currentMonth = toIsoMonth(today.getFullYear(), today.getMonth())

const triggerLabel = computed(() => {
  if (!selectedMonth.value) return ''
  return monthLabel(Number(selectedMonth.value.slice(0, 4)), Number(selectedMonth.value.slice(5, 7)))
})

async function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  year.value = selectedMonth.value ? Number(selectedMonth.value.slice(0, 4)) : today.getFullYear()
  open.value = true
  await nextTick()
  panel.value?.focus()
}

function close() {
  open.value = false
  trigger.value?.focus()
}

function pick(month0: number) {
  emit('update:modelValue', toIsoMonth(year.value, month0))
  close()
}

function clear() {
  emit('update:modelValue', '')
  close()
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
    close()
  },
  { capture: true },
)
</script>

<template>
  <div ref="root" :class="cn('relative w-full', props.class)">
    <button
      :id="props.id"
      ref="trigger"
      type="button"
      :disabled="props.disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :class="cn(
        'flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-card/60 px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
        selectedMonth ? 'pr-9 text-foreground' : 'text-muted-foreground/70',
      )"
      @click="toggle"
    >
      <Calendar class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ triggerLabel || props.placeholder || 'Select month' }}</span>
    </button>
    <button
      v-if="selectedMonth && !props.disabled"
      type="button"
      aria-label="Clear month"
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
        aria-label="Choose month"
        tabindex="-1"
        :data-year="year"
        data-popover-layer
        class="glass-card glass-panel absolute left-0 top-[calc(100%+0.375rem)] z-50 w-72 rounded-xl p-3 focus-visible:outline-none focus-visible:shadow-none"
      >
        <div class="flex items-center justify-between pb-2">
          <button
            type="button"
            aria-label="Previous year"
            :class="navBtnClass"
            @click="year -= 1"
          >
            <ChevronLeft class="size-4" />
          </button>
          <span class="text-sm font-medium text-foreground">{{ year }}</span>
          <button type="button" aria-label="Next year" :class="navBtnClass" @click="year += 1">
            <ChevronRight class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="(m, i) in MONTHS"
            :key="m"
            type="button"
            :data-month="toIsoMonth(year, i)"
            :aria-label="monthLabel(year, i + 1)"
            :aria-pressed="toIsoMonth(year, i) === selectedMonth"
            :class="cn(
              'flex h-9 items-center justify-center rounded-lg font-mono text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              toIsoMonth(year, i) === selectedMonth
                ? 'bg-primary bg-brand-gradient font-semibold text-primary-foreground shadow-glow hover:opacity-90'
                : 'text-foreground',
              toIsoMonth(year, i) === currentMonth &&
                toIsoMonth(year, i) !== selectedMonth &&
                'font-semibold text-primary ring-1 ring-inset ring-ring/60',
            )"
            @click="pick(i)"
          >
            {{ m.slice(0, 3) }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
