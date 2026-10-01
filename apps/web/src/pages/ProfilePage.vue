<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { Doctor } from '@oncall/shared'
import { changePasswordSchema, languageSchema, updateUsernameSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import * as doctorService from '@/services/doctor'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Label from '@/components/ui/Label.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'

const currentPassword = ref('')
const newPassword = ref('')
const formError = ref('')
const submitting = ref(false)
const newUsername = ref('')
const usernameError = ref('')
const usernameSuccess = ref(false)
const usernameSubmitting = ref(false)


const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const heading = computed(() =>
  auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : t('nav.profile'),
)

const myDoctor = ref<Doctor | null>(null)
const doctorError = ref('')
const isDoctor = computed(() => auth.user?.role === 'doctor')
const darkMode = computed(() => auth.user?.darkMode ?? false)
const themeError = ref('')
const language = computed(() => auth.user?.language ?? 'en')
const languageError = ref('')

async function loadMyDoctor() {
  if (!isDoctor.value) return
  doctorError.value = ''
  try {
    myDoctor.value = await doctorService.me()
  } catch (e) {
    doctorError.value = e instanceof Error ? e.message : t('profile.loadFailed')
  }
}

async function onToggleDarkMode(value: boolean) {
  themeError.value = ''
  try {
    await auth.setDarkMode(value)
  } catch (e) {
    themeError.value = e instanceof ApiError ? e.message : t('profile.themeSaveFailed')
  }
}

async function onSelectLanguage(value: string | number) {
  languageError.value = ''
  const parsed = languageSchema.safeParse(value)
  if (!parsed.success || parsed.data === language.value) return
  try {
    await auth.setLanguage(parsed.data)
  } catch (e) {
    languageError.value = e instanceof ApiError ? e.message : t('profile.languageSaveFailed')
  }
}


onMounted(() => {
  // Doctors can rename themselves; start from the current username.
  if (isDoctor.value && auth.user) newUsername.value = auth.user.username
  loadMyDoctor()
})

async function onSubmit() {
  formError.value = ''
  const parsed = changePasswordSchema.safeParse({
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(parsed.data.currentPassword, parsed.data.newPassword)
    // The API revoked every session, including this one: sign out and say why.
    await auth.logout()
    await router.push({ name: 'login', query: { passwordChanged: '1' } })
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : t('profile.passwordChangeFailed')
  } finally {
    submitting.value = false
  }
}

async function onSubmitUsername() {
  usernameError.value = ''
  usernameSuccess.value = false
  const parsed = updateUsernameSchema.safeParse({ username: newUsername.value })
  if (!parsed.success) {
    usernameError.value = parsed.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  usernameSubmitting.value = true
  try {
    await auth.setUsername(parsed.data.username)
    usernameSuccess.value = true
  } catch (e) {
    usernameError.value = e instanceof ApiError ? e.message : t('profile.usernameChangeFailed')
  } finally {
    usernameSubmitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 animate-rise">
    <div class="flex items-center gap-4">
      <Avatar :name="heading" size="lg" />
      <div class="min-w-0">
        <h1 class="font-display text-2xl font-bold tracking-tight text-foreground">{{ heading }}</h1>
        <p v-if="auth.user" class="hud-label mt-1 truncate">{{ t(`roles.${auth.user.role}`) }} · {{ auth.user.email }}</p>
      </div>
    </div>
    <div class="hud-scan" aria-hidden="true"></div>

    <div class="grid flex-1 items-stretch gap-4 md:grid-cols-2">
      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>{{ t('profile.passwordTitle') }}</CardTitle>
          <CardDescription class="text-xs">
            {{ t('profile.passwordDescription') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <form class="flex flex-1 flex-col gap-3" novalidate @submit.prevent="onSubmit">
            <div class="flex flex-col gap-1.5">
              <Label for="current">{{ t('profile.currentPassword') }}</Label>
              <Input id="current" v-model="currentPassword" type="password" autocomplete="current-password" />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="new">{{ t('profile.newPassword') }}</Label>
              <Input id="new" v-model="newPassword" type="password" autocomplete="new-password" />
            </div>
            <p v-if="formError" class="text-xs text-destructive" role="alert">{{ formError }}</p>
            <Button class="mt-auto" type="submit" :disabled="submitting">{{ t('profile.updatePassword') }}</Button>
          </form>
        </CardContent>
      </Card>

      <Card v-if="isDoctor" class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>{{ t('profile.usernameTitle') }}</CardTitle>
          <CardDescription class="text-xs">
            {{ t('profile.usernameDescription') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <form class="flex flex-1 flex-col gap-3" novalidate @submit.prevent="onSubmitUsername">
            <div class="flex flex-col gap-1.5">
              <Label for="username">{{ t('profile.usernameTitle') }}</Label>
              <Input id="username" v-model="newUsername" autocomplete="username" />
            </div>
            <p v-if="usernameError" class="text-xs text-destructive" role="alert">{{ usernameError }}</p>
            <p v-if="usernameSuccess" class="text-xs text-success" role="status">{{ t('profile.usernameUpdated') }}</p>
            <Button class="mt-auto" type="submit" :disabled="usernameSubmitting">{{ t('profile.updateUsername') }}</Button>
          </form>
        </CardContent>
      </Card>

      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>{{ t('profile.appearanceTitle') }}</CardTitle>
          <CardDescription class="text-xs">
            {{ t('profile.appearanceDescription') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <div class="flex items-center justify-between gap-4">
            <Label for="dark-mode">{{ t('profile.darkMode') }}</Label>
            <Switch id="dark-mode" :model-value="darkMode" @update:model-value="onToggleDarkMode" />
          </div>
          <p v-if="themeError" class="mt-3 text-xs text-destructive" role="alert">{{ themeError }}</p>
        </CardContent>
      </Card>

      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>{{ t('profile.languageTitle') }}</CardTitle>
          <CardDescription class="text-xs">
            {{ t('profile.languageDescription') }}
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <div class="flex flex-col gap-1.5">
            <Label for="language">{{ t('profile.languageTitle') }}</Label>
            <!-- Each language is named in its own language, whatever the UI language. -->
            <Select id="language" :model-value="language" @update:model-value="onSelectLanguage">
              <option value="en">English</option>
              <option value="el">Ελληνικά</option>
            </Select>
          </div>
          <p v-if="languageError" class="mt-3 text-xs text-destructive" role="alert">{{ languageError }}</p>
        </CardContent>
      </Card>

      <Card v-if="isDoctor" class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>{{ t('profile.onCallTitle') }}</CardTitle>
          <CardDescription class="text-xs">{{ t('profile.onCallDescription') }}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <p v-if="doctorError" class="text-xs text-destructive" role="alert">{{ doctorError }}</p>
          <dl v-else-if="myDoctor" class="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt class="text-muted-foreground">{{ t('profile.email') }}</dt>
            <dd class="truncate">{{ myDoctor.email }}</dd>
            <dt class="text-muted-foreground">{{ t('profile.status') }}</dt>
            <dd>{{ myDoctor.isActive ? t('profile.active') : t('profile.disabled') }}</dd>
            <dt class="text-muted-foreground">{{ t('profile.maxMonthlyDuties') }}</dt>
            <dd class="font-mono">{{ myDoctor.maxMonthlyDuties }}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
