<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const PALETTE = [
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
]

const SIZES = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

const props = defineProps<{
  name: string
  size?: keyof typeof SIZES
  class?: HTMLAttributes['class']
}>()

const initials = computed(() =>
  props.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase(),
)

const hue = computed(() => [...props.name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length)
</script>

<template>
  <span
    :class="cn('grid shrink-0 select-none place-items-center rounded-full font-semibold', PALETTE[hue], SIZES[props.size ?? 'md'], props.class)"
  >
    {{ initials }}
  </span>
</template>
