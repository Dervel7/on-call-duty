<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  id?: string
  modelValue: boolean
  disabled?: boolean
  class?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    :id="id"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    :class="
      cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        modelValue ? 'bg-primary' : 'bg-input',
        props.class,
      )
    "
    @click="toggle"
  >
    <span
      :class="
        cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm ring-0 transition-transform',
          modelValue ? 'translate-x-5' : 'translate-x-0',
        )
      "
    />
  </button>
</template>
