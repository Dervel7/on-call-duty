<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { monthGrid, monthLabel as formatMonth, toIsoMonth, weekdayNames } from '@oncall/utils'
import { cn } from '@/lib/utils'
import { useModal } from '@/composables/useModal'
import { useIntlLocale } from '@/composables/useIntlLocale'
import Button from './Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    modelValue: string[]
    /** Month ('YYYY-MM') the calendar opens on when no day is preselected. */
    initialMonth?: string
    /** Days already excluded elsewhere; shown dimmed and not selectable. */
    reservedDays?: string[]
    /** Confirm button label; defaults to the translated "Confirm". */
    confirmText?: string
  }>(),
  { reservedDays: () => [] },
)
const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:modelValue': [days: string[]]
}>()

const { t } = useI18n()
const intlLocale = useIntlLocale()
const today = new Date()

const view = ref({ year: today.getFullYear(), month0: today.getMonth() })
const selected = ref<Set<string>>(new Set())
const reserved = computed(() => new Set(props.reservedDays))
const panel = ref<HTMLElement | null>(null)
const titleId = useId()

const monthLabel = computed(() => formatMonth(view.value.year, view.value.month0 + 1, intlLocale.value))
const weekdays = computed(() => weekdayNames(intlLocale.value))
const dayLabelFormat = computed(
  () => new Intl.DateTimeFormat(intlLocale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
)

const cells = computed(() =>
  monthGrid(view.value.year, view.value.month0).map((c) =>
    c && { ...c, label: dayLabelFormat.value.format(new Date(view.value.year, view.value.month0, c.day)) },
  ),
)

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
    } else if (props.initialMonth) {
      view.value = {
        year: Number(props.initialMonth.slice(0, 4)),
        month0: Number(props.initialMonth.slice(5, 7)) - 1,
      }
    } else {
      view.value = { year: today.getFullYear(), month0: today.getMonth() }
    }
  },
  { immediate: true },
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

useModal(() => props.open, panel)
</script>

<template>
  <Teleport to="body">
    <!-- data-popover-layer covers backdrop + panel: an enclosing Dialog must
         treat the entire calendar surface as "inside", so its click-outside
         handler never fires while the calendar is open. -->
    <div v-if="open" data-popover-layer class="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4">
      <div
        class="animate-dialog-backdrop absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        @click="close"
      />
      <div
        ref="panel"
        :data-month="toIsoMonth(view.year, view.month0)"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-label="title ? undefined : t('calendarDialog.pickDays')"
        tabindex="-1"
        class="animate-dialog-panel glass-card glass-panel relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl p-3 focus-visible:outline-none"
      >
        <button
          type="button"
          :aria-label="t('common.close')"
          class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 v-if="title" :id="titleId" class="mb-3 pr-10 text-lg font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>

        <div class="flex items-center justify-between pb-2">
          <button
            type="button"
            :aria-label="t('common.previousMonth')"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="shiftMonth(-1)"
          >
            <ChevronLeft class="size-4" />
          </button>
          <span class="text-sm font-medium text-foreground">{{ monthLabel }}</span>
          <button
            type="button"
            :aria-label="t('common.nextMonth')"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            @click="shiftMonth(1)"
          >
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
              :aria-pressed="selected.has(c.iso)"
              :disabled="reserved.has(c.iso)"
              :title="reserved.has(c.iso) ? t('calendarDialog.alreadyExcluded') : undefined"
              :class="cn(
                'flex h-9 items-center justify-center rounded-lg font-mono text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                selected.has(c.iso)
                  ? 'bg-primary bg-brand-gradient font-semibold text-primary-foreground shadow-glow hover:opacity-90'
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

        <p class="mt-3 text-xs text-muted-foreground">{{ t('calendarDialog.daysSelected', selected.size) }}</p>

        <div class="mt-4 flex justify-end gap-2">
          <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
          <Button :disabled="selected.size === 0" @click="confirmDays">{{ confirmText ?? t('common.confirm') }}</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
