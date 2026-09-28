<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import { BellRing, CalendarCheck2, ShieldCheck } from 'lucide-vue-next'
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
  if (!identifier.value.trim() || !password.value) {
    formError.value = 'Username and Password must not be empty'
    return
  }
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
  <div class="grid min-h-screen lg:grid-cols-2">
    <aside class="relative hidden flex-col overflow-hidden bg-[#060a16] p-12 lg:flex">
      <div
        class="pointer-events-none absolute inset-0 [background:radial-gradient(38%_32%_at_20%_14%,hsl(192_100%_50%/0.2),transparent_70%),radial-gradient(34%_30%_at_82%_10%,hsl(262_95%_60%/0.18),transparent_70%),radial-gradient(52%_44%_at_55%_110%,hsl(320_95%_55%/0.1),transparent_72%)]"
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(hsl(220_60%_70%/0.07)_1px,transparent_1px),linear-gradient(90deg,hsl(220_60%_70%/0.07)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_90%_80%_at_50%_0%,black_25%,transparent_78%)]"
        aria-hidden="true"
      ></div>

      <div class="hud-corners relative flex h-full flex-col justify-between">
        <div class="flex items-center gap-3">
          <span class="brand-tile">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z" fill="currentColor"
                class="text-primary-foreground" />
            </svg>
          </span>
          <span class="flex flex-col leading-none">
            <span class="font-display text-lg font-bold tracking-tight text-white">On-Call Duty</span>
            <span
              class="mt-1 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-cyan-300/80"
            >
              Hospital Scheduling
            </span>
          </span>
        </div>

        <div>
          <p class="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
            Mission control · on-call rosters
          </p>
          <h1 class="mt-4 max-w-md font-display text-5xl font-bold leading-[1.05] tracking-tight text-white">
            Fair on-call rosters.
            <span class="text-brand-gradient">Zero spreadsheet chaos.</span>
          </h1>
          <ul class="mt-10 flex flex-col gap-5 text-sm font-medium text-white/80">
            <li class="flex items-center gap-4">
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-cyan-300 ring-1 ring-inset ring-white/15">
                <CalendarCheck2 class="size-4" />
              </span>
              Balanced weekends, automatically
            </li>
            <li class="flex items-center gap-4">
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-cyan-300 ring-1 ring-inset ring-white/15">
                <ShieldCheck class="size-4" />
              </span>
              Hospital rules enforced for you
            </li>
            <li class="flex items-center gap-4">
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-cyan-300 ring-1 ring-inset ring-white/15">
                <BellRing class="size-4" />
              </span>
              Always know when you're on call
            </li>
          </ul>
        </div>

        <svg class="h-24 w-full text-cyan-400/70" viewBox="0 0 1200 160" preserveAspectRatio="none" fill="none"
          aria-hidden="true">
          <path d="M0 90 H320 l28-58 l34 116 l30-150 l36 92 H760 l26-46 l32 80 H1200" class="ekg-line" stroke="currentColor"
            stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </aside>

    <div class="relative grid place-items-center overflow-hidden px-6 py-12 animate-rise">
      <div
        class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/15 via-background-tint to-accent/15">
      </div>

      <Card class="hud-corners w-full max-w-md rounded-2xl shadow-pop">
        <div class="flex flex-col items-center gap-3 px-6 pt-7 text-center">
          <div class="relative">
            <span class="pulse-ring absolute inset-0 rounded-[0.75rem] bg-primary/25"></span>
            <span class="brand-tile relative">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" aria-hidden="true">
                <path d="M10.5 3h3v5.5H19v3h-5.5V21h-3v-9.5H5v-3h5.5z" fill="currentColor"
                  class="text-primary-foreground" />
              </svg>
            </span>
          </div>
          <div>
            <p class="font-display text-base font-bold tracking-tight text-foreground">On-Call Duty</p>
            <p class="hud-label mt-1">Hospital Scheduling</p>
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
              <Input id="identifier" v-model="identifier" type="text" />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="password">Password</Label>
              <Input id="password" v-model="password" type="password" />
            </div>
            <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
            <Button type="submit" :disabled="submitting" :aria-busy="submitting">
              {{ submitting ? 'Signing in…' : 'Sign in' }}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
