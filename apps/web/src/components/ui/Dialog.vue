<script lang="ts">
import { ref as moduleRef } from 'vue'

// Open dialogs in opening order, shared by every Dialog instance. Only the
// last (top) one reacts to Escape and outside clicks, and each one is layered
// above the dialogs opened before it — teleport DOM order alone can't
// guarantee that (ConfirmDialog is mounted once, early, in the layout).
const openStack = moduleRef<symbol[]>([])
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useModal } from '@/composables/useModal'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const panel = ref<HTMLElement | null>(null)
const self = Symbol('dialog')
const titleId = useId()

const stackIndex = computed(() => openStack.value.indexOf(self))
const isTop = computed(() => stackIndex.value !== -1 && stackIndex.value === openStack.value.length - 1)

function close() {
  if (props.open) emit('update:open', false)
}

function closeIfTop() {
  if (isTop.value) close()
}

// Clicks inside a popover layer (e.g. a Select's teleported option list, or a
// dialog stacked on top of this one) belong to this dialog's surface.
onClickOutside(panel, closeIfTop, { ignore: ['[data-popover-layer]'] })
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') closeIfTop()
})

function leaveStack() {
  openStack.value = openStack.value.filter((s) => s !== self)
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      if (!openStack.value.includes(self)) openStack.value = [...openStack.value, self]
    } else {
      leaveStack()
    }
  },
  { immediate: true },
)

onBeforeUnmount(leaveStack)
useModal(() => props.open, panel)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-popover-layer
      class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      :style="{ zIndex: 50 + Math.max(stackIndex, 0) }"
    >
      <div
        class="animate-dialog-backdrop absolute inset-0 bg-foreground/50 backdrop-blur-md"
        @click="closeIfTop"
      />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
        class="animate-dialog-panel glass-card glass-panel relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-6 focus-visible:outline-none"
      >
        <button
          type="button"
          :aria-label="t('common.close')"
          class="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 v-if="title" :id="titleId" class="mb-4 pr-10 text-lg font-semibold tracking-tight text-foreground">
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
