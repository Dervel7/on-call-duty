<script setup lang="ts">
import { ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import Button from './Button.vue'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const panel = ref<HTMLElement | null>(null)

function close() {
  if (props.open) emit('update:open', false)
}

// Clicks inside a popover layer (e.g. a Select's teleported option list)
// belong to this dialog's surface, not to the outside.
onClickOutside(panel, close, { ignore: ['[data-popover-layer]'] })
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') close()
})

watch(
  () => props.open,
  (v) => {
    if (v) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="animate-dialog-backdrop absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        @click="close"
      />
      <div
        ref="panel"
        class="animate-dialog-panel relative z-10 w-full max-w-md rounded-xl border border-border/80 bg-card p-6 shadow-pop"
      >
        <h2 v-if="title" class="mb-4 text-lg font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>
        <slot />
        <div class="mt-6 flex justify-end gap-2">
          <slot name="footer">
            <Button variant="outline" @click="close">Close</Button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>
