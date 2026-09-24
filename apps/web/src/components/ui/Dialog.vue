<script setup lang="ts">
import { ref, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { X } from 'lucide-vue-next'

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
        <button
          type="button"
          aria-label="Close"
          class="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 v-if="title" class="mb-4 pr-10 text-lg font-semibold tracking-tight text-foreground">
          {{ title }}
        </h2>
        <slot />
        <div v-if="$slots.footer" class="mt-6 flex justify-end gap-2">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
