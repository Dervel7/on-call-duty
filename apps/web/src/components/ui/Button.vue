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
          'bg-primary text-primary-foreground bg-brand-gradient shadow-md shadow-primary/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/40 active:translate-y-0 active:shadow-md active:shadow-primary/30',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        destructive:
          'bg-destructive text-destructive-foreground shadow-md shadow-destructive/25 hover:-translate-y-0.5 hover:bg-destructive/90 active:translate-y-0',
        outline: 'border border-input bg-card hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
        accent:
          'bg-accent text-accent-foreground shadow-md shadow-accent/30 hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0',
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
