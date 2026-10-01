<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, nextTick, ref } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { monthGrid, monthLabel as formatMonth, toIsoDate, toIsoMonth, weekdayNames } from '@oncall/utils'
import { cn } from '@/lib/utils'
import { useIntlLocale } from '@/composables/useIntlLocale'

const props = defineProps<{
  id?: string
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const intlLocale = useIntlLocale()
const today = new Date()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const view = ref({ year: today.getFullYear(), month0: today.getMonth() })

const dayFormat = computed(() => new Intl.DateTimeFormat(intlLocale.value, { day: 'numeric', month: 'short', year: 'numeric' }))
const dayLabelFormat = computed(
  () => new Intl.DateTimeFormat(intlLocale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
)

const navBtnClass =
  'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

const todayIso = toIsoDate(today)

const selectedIso = computed(() =>
  props.modelValue && /^\d{4}-\d{2}-\d{2}$/.test(props.modelValue) ? props.modelValue : '',
)

const triggerLabel = computed(() => {
  if (!selectedIso.value) return ''
  const d = new Date(`${selectedIso.value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? selectedIso.value : dayFormat.value.format(d)
})

const monthLabel = computed(() => formatMonth(view.value.year, view.value.month0 + 1, intlLocale.value))
const weekdays = computed(() => weekdayNames(intlLocale.value))

const cells = computed(() =>
  monthGrid(view.value.year, view.value.month0).map((c) =>
    c && { ...c, label: dayLabelFormat.value.format(new Date(view.value.year, view.value.month0, c.day)) },
  ),
)

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

function close() {
  open.value = false
  trigger.value?.focus()
}

function pick(iso: string) {
  emit('update:modelValue', iso)
  close()
}

function clear() {
  emit('update:modelValue', '')
  close()
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
        selectedIso ? 'pr-9 text-foreground' : 'text-muted-foreground/70',
      )"
      @click="toggle"
    >
      <Calendar class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate">{{ triggerLabel || props.placeholder || t('datePicker.selectDate') }}</span>
    </button>
    <button
      v-if="selectedIso && !props.disabled"
      type="button"
      :aria-label="t('datePicker.clearDate')"
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
        :aria-label="t('datePicker.chooseDate')"
        tabindex="-1"
        :data-month="toIsoMonth(view.year, view.month0)"
        data-popover-layer
        class="glass-card glass-panel absolute left-0 top-[calc(100%+0.375rem)] z-50 w-80 rounded-xl p-3 focus-visible:outline-none focus-visible:shadow-none"
      >
        <div class="flex items-center justify-between pb-2">
          <button type="button" :aria-label="t('common.previousMonth')" :class="navBtnClass" @click="shiftMonth(-1)">
            <ChevronLeft class="size-4" />
          </button>
          <span class="text-sm font-medium text-foreground">{{ monthLabel }}</span>
          <button type="button" :aria-label="t('common.nextMonth')" :class="navBtnClass" @click="shiftMonth(1)">
            <ChevronRight class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-7">
          <span
            v-for="w in weekdays"
            :key="w"
            class="py-1 text-center font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80"
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
              :aria-label="c.label"
              :aria-pressed="c.iso === selectedIso"
              :aria-current="c.iso === todayIso ? 'date' : undefined"
              :class="cn(
                'flex h-9 items-center justify-center rounded-lg font-mono text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                c.iso === selectedIso
                  ? 'bg-primary bg-brand-gradient font-semibold text-primary-foreground shadow-glow hover:opacity-90'
                  : c.weekend
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                c.iso === todayIso && c.iso !== selectedIso && 'font-semibold text-primary ring-1 ring-inset ring-ring/60',
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
            class="rounded-full px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="view = { year: today.getFullYear(), month0: today.getMonth() }"
          >
            {{ t('datePicker.today') }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
