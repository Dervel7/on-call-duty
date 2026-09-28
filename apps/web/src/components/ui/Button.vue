<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // bg-primary stays as a solid fallback under the gradient layer and is asserted by ConfirmDialog.test.ts
        default:
          'bg-primary text-primary-foreground bg-brand-gradient btn-shine shadow-glow hover:-translate-y-0.5 hover:shadow-glow-lg active:translate-y-0 active:shadow-glow',
        secondary: 'bg-secondary/70 text-secondary-foreground backdrop-blur hover:bg-secondary',
        destructive:
          'bg-destructive text-destructive-foreground btn-shine shadow-[0_0_22px_-6px_hsl(var(--destructive)/0.55)] hover:-translate-y-0.5 hover:bg-destructive/90 active:translate-y-0',
        outline:
          'border border-border bg-card/50 text-foreground backdrop-blur hover:border-primary/50 hover:bg-primary/5 hover:shadow-glow',
        accent:
          'bg-accent text-accent-foreground btn-shine shadow-[0_0_22px_-6px_hsl(var(--accent)/0.5)] hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-9 px-3.5',
        lg: 'h-12 px-8',
        icon: 'h-10 w-10 rounded-xl',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonVariants = VariantProps<typeof buttonVariants>

const props = defineProps<{
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <button :class="cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)">
    <slot />
  </button>
</template>
