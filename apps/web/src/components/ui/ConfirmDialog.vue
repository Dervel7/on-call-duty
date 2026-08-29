<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import Dialog from './Dialog.vue'
import Button from './Button.vue'
import { useConfirmState } from '@/composables/useConfirm'

const { request, settle } = useConfirmState()
const footer = ref<HTMLElement | null>(null)

watch(
  () => request.value,
  async (r) => {
    if (!r) return
    await nextTick()
    const buttons = footer.value?.querySelectorAll('button')
    if (!buttons || buttons.length === 0) return
    const target = r.variant === 'primary' ? buttons[buttons.length - 1] : buttons[0]
    target?.focus()
  },
)
</script>

<template>
  <Dialog :open="request !== null" :title="request?.title" @update:open="settle(false)">
    <div v-if="request" class="flex items-start gap-4">
      <span
        :class="request.variant === 'primary'
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'
          : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive'"
      >
        <TriangleAlert class="h-5 w-5" />
      </span>
      <p class="pt-2 text-sm text-muted-foreground">{{ request.message }}</p>
    </div>
    <template #footer>
      <div ref="footer" class="contents">
        <Button variant="outline" @click="settle(false)">{{ request?.cancelText }}</Button>
        <Button
          :variant="request?.variant === 'primary' ? 'default' : 'destructive'"
          @click="settle(true)"
        >
          {{ request?.confirmText }}
        </Button>
      </div>
    </template>
  </Dialog>
</template>
