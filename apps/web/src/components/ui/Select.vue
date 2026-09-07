<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { VNode } from 'vue'
import { Fragment, computed, nextTick, ref, useId, useSlots, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Check, ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  id?: string
  modelValue?: string | number
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

/**
 * Drop-in replacement for the native <select>: options are declared with the
 * same slot markup callers already use (<option>/<optgroup>), parsed here and
 * rendered as a styled listbox popover. Values are emitted as strings, exactly
 * like the native control.
 */

interface Option {
  value: string
  label: string
  disabled: boolean
}
interface Group {
  label: string
  options: Option[]
}

const slots = useSlots()
const uid = useId()

function textOf(children: unknown): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (children && typeof children === 'object' && 'children' in children) {
    return textOf((children as { children?: unknown }).children)
  }
  return ''
}

function childVnodes(children: unknown): VNode[] {
  if (!Array.isArray(children)) return []
  return children.flatMap((c) => {
    if (Array.isArray(c)) return childVnodes(c)
    const v = c as VNode
    if (v.type === Fragment) return childVnodes(v.children)
    return [v]
  })
}

function optionOf(v: VNode): Option {
  return {
    value: String(v.props?.value ?? ''),
    label: textOf(v.children).trim(),
    disabled: v.props?.disabled === true || v.props?.disabled === '',
  }
}

const groups = computed<Group[]>(() => {
  const ungrouped: Option[] = []
  const out: Group[] = [{ label: '', options: ungrouped }]
  for (const v of childVnodes(slots.default?.())) {
    if (v.type === 'option') ungrouped.push(optionOf(v))
    else if (v.type === 'optgroup') {
      const options = childVnodes(v.children)
        .filter((c) => c.type === 'option')
        .map(optionOf)
      out.push({ label: String(v.props?.label ?? ''), options })
    }
  }
  return out
})

const flatOptions = computed<Option[]>(() => groups.value.flatMap((g) => g.options))
const selectedValue = computed(() => String(props.modelValue ?? ''))
const selected = computed(() => flatOptions.value.find((o) => o.value === selectedValue.value))
const active = computed(() => flatOptions.value.find((o) => o.value === activeValue.value))

const open = ref(false)
const activeValue = ref('')
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

function positionPanel() {
  const btn = root.value?.querySelector('button')
  const p = panel.value
  if (!btn || !p) return
  const r = btn.getBoundingClientRect()
  p.style.left = `${r.left}px`
  p.style.top = `${r.bottom + 6}px`
  p.style.width = `${Math.max(r.width, 176)}px`
  p.style.maxHeight = `${Math.max(180, window.innerHeight - r.bottom - 16)}px`
}

async function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  activeValue.value = selectedValue.value
  open.value = true
  await nextTick()
  positionPanel()
  panel.value?.focus()
}

function choose(o: Option) {
  if (o.disabled) return
  emit('update:modelValue', o.value)
  open.value = false
}

function move(delta: number) {
  const opts = flatOptions.value
  if (!opts.length) return
  let i = opts.findIndex((o) => o.value === activeValue.value)
  for (let step = 0; step < opts.length; step++) {
    i = (i + delta + opts.length) % opts.length
    if (!opts[i]!.disabled) break
  }
  activeValue.value = opts[i]!.value
}

function firstEnabled(opts: Option[]): Option | undefined {
  return opts.find((o) => !o.disabled)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    const o = firstEnabled(flatOptions.value)
    if (o) activeValue.value = o.value
  } else if (e.key === 'End') {
    e.preventDefault()
    const o = firstEnabled([...flatOptions.value].reverse())
    if (o) activeValue.value = o.value
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (active.value) choose(active.value)
  } else if (e.key === 'Tab') {
    open.value = false
  }
}

watch(activeValue, async () => {
  await nextTick()
  panel.value
    ?.querySelector(`[data-value="${activeValue.value}"]`)
    // jsdom has no scrollIntoView; the optional call keeps tests green
    ?.scrollIntoView?.({ block: 'nearest' })
})

useEventListener(document, 'click', (e: MouseEvent) => {
  if (!open.value) return
  const t = e.target as Node
  if (root.value?.contains(t) || panel.value?.contains(t)) return
  open.value = false
})

// The panel is teleported (so DutyCalendar's overflow-x-auto cannot clip it);
// any scroll outside the panel itself closes it instead of misplacing it.
useEventListener(
  window,
  'scroll',
  (e: Event) => {
    if (!open.value || panel.value?.contains(e.target as Node)) return
    open.value = false
  },
  { capture: true, passive: true },
)

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
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :disabled="props.disabled"
      class="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm text-foreground shadow-sm transition-colors hover:border-input/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
      @click="toggle"
    >
      <span class="truncate" :class="!selected && 'text-muted-foreground/70'">
        {{ selected?.label ?? selectedValue }}
      </span>
      <ChevronDown
        :class="cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')"
      />
    </button>

    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 -translate-y-1"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="opacity-0 -translate-y-1"
      >
        <div
          v-if="open"
          ref="panel"
          role="listbox"
          tabindex="-1"
          data-popover-layer
          :aria-activedescendant="active ? `${uid}-opt-${flatOptions.indexOf(active)}` : undefined"
          class="fixed z-50 overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 shadow-pop focus-visible:outline-none focus-visible:shadow-none"
          @keydown="onKeydown"
        >
          <template v-for="g in groups" :key="g.label">
            <div
              v-if="g.label"
              class="px-2.5 pb-1 pt-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {{ g.label }}
            </div>
            <button
              v-for="o in g.options"
              :id="`${uid}-opt-${flatOptions.indexOf(o)}`"
              :key="o.value"
              type="button"
              role="option"
              :data-value="o.value"
              :aria-selected="o.value === selectedValue"
              :disabled="o.disabled"
              :class="cn(
                'flex h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm transition-colors',
                o.disabled
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : 'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                o.value === selectedValue && 'bg-primary/10 font-medium text-primary',
                o.value === activeValue && o.value !== selectedValue && 'bg-muted',
              )"
              @click="choose(o)"
              @mouseenter="!o.disabled && (activeValue = o.value)"
            >
              <span class="truncate">{{ o.label }}</span>
              <Check v-if="o.value === selectedValue" class="size-4 shrink-0" />
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
