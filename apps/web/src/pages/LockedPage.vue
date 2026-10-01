<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'

const { t } = useI18n()
</script>

<template>
  <div class="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12 animate-rise">
    <div
      class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background-tint to-accent/10">
    </div>

    <Card class="hud-corners w-full max-w-md rounded-2xl shadow-pop">
      <CardHeader class="items-center text-center">
        <div class="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/25">
          <Lock class="size-6" />
        </div>
        <CardTitle>{{ t('locked.title') }}</CardTitle>
        <CardDescription>{{ t('locked.message') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex justify-center">
        <RouterLink class="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/login">
          {{ t('locked.goToLogin') }}
        </RouterLink>
      </CardContent>
    </Card>
  </div>
</template>
