<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

const identifier = ref('')
const password = ref('')
const formError = ref('')
const submitting = ref(false)

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

async function onSubmit() {
  formError.value = ''
  const parsed = loginSchema.safeParse({ identifier: identifier.value, password: password.value })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  submitting.value = true
  try {
    await auth.login(parsed.data.identifier, parsed.data.password)
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : 'Login failed'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12">
    <div
      class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-background-tint to-accent/10">
    </div>

    <svg class="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 w-full text-primary/20"
      viewBox="0 0 1200 160" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <path d="M0 90 H320 l28-58 l34 116 l30-150 l36 92 H760 l26-46 l32 80 H1200" class="ekg-line" stroke="currentColor"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <Card class="w-full max-w-md shadow-pop">
      <div class="flex flex-col items-center gap-3 px-6 pt-7 text-center">
        <div class="relative">
          <span class="pulse-ring absolute inset-0 rounded-[0.6rem] bg-primary/25"></span>
          <span class="brand-tile relative">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z" fill="currentColor"
                class="text-primary-foreground" />
            </svg>
          </span>
        </div>
        <div>
          <p class="text-base font-semibold tracking-tight text-foreground">On-Call Duty</p>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            Hospital Scheduling
          </p>
        </div>
      </div>

      <CardHeader class="items-center text-center">
        <CardTitle>Sign in</CardTitle>
        <CardDescription>On-Call Duty staff login</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <div class="flex flex-col gap-2">
            <Label for="identifier">Email or username</Label>
            <Input id="identifier" v-model="identifier" type="text" autocomplete="username" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="password">Password</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" />
          </div>
          <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
          <Button type="submit" :disabled="submitting" :aria-busy="submitting">
            {{ submitting ? 'Signing in…' : 'Sign in' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
