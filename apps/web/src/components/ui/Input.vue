<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: string | number
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    :value="props.modelValue"
    :class="cn(
      'flex h-10 w-full rounded-lg border border-input bg-card/60 px-3.5 py-2 text-sm text-foreground shadow-sm transition-all placeholder:text-muted-foreground/50 hover:border-primary/40 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:opacity-50',
      props.class,
    )"
    @input="onInput"
  />
</template>
