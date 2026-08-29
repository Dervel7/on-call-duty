import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'destructive' | 'primary'
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmText: string
  cancelText: string
  variant: 'destructive' | 'primary'
  resolve: (value: boolean) => void
}

const request = ref<ConfirmRequest | null>(null)

function confirm(options: ConfirmOptions): Promise<boolean> {
  request.value?.resolve(false)
  return new Promise((resolve) => {
    request.value = {
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Confirm',
      cancelText: options.cancelText ?? 'Cancel',
      variant: options.variant ?? 'destructive',
      resolve,
    }
  })
}

function settle(value: boolean): void {
  request.value?.resolve(value)
  request.value = null
}

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean> } {
  return { confirm }
}

export function useConfirmState(): {
  request: typeof request
  settle: (value: boolean) => void
} {
  return { request, settle }
}
