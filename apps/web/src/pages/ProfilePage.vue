<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Doctor } from '@oncall/shared'
import { changePasswordSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { useAuthStore } from '@/stores/auth'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'

const currentPassword = ref('')
const newPassword = ref('')
const formError = ref('')
const success = ref(false)
const submitting = ref(false)

const auth = useAuthStore()
const heading = computed(() =>
  auth.user ? `${auth.user.firstName} ${auth.user.lastName}` : 'Profile',
)

const myDoctor = ref<Doctor | null>(null)
const doctorError = ref('')
const isDoctor = computed(() => auth.user?.role === 'doctor')

async function loadMyDoctor() {
  if (!isDoctor.value) return
  doctorError.value = ''
  try {
    myDoctor.value = await doctorService.me()
  } catch (e) {
    doctorError.value = e instanceof Error ? e.message : 'Could not load profile'
  }
}

onMounted(loadMyDoctor)

async function onSubmit() {
  formError.value = ''
  success.value = false
  const parsed = changePasswordSchema.safeParse({
    currentPassword: currentPassword.value,
    newPassword: newPassword.value,
  })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  submitting.value = true
  try {
    await auth.changePassword(parsed.data.currentPassword, parsed.data.newPassword)
    success.value = true
    currentPassword.value = ''
    newPassword.value = ''
  } catch (e) {
    formError.value = e instanceof ApiError ? e.message : 'Could not change password'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md">
    <Card>
      <CardHeader>
        <CardTitle>{{ heading }}</CardTitle>
        <CardDescription>Change your password. You will be signed out of all sessions, including this one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <div class="flex flex-col gap-2">
            <Label for="current">Current password</Label>
            <Input id="current" v-model="currentPassword" type="password" autocomplete="current-password" />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="new">New password</Label>
            <Input id="new" v-model="newPassword" type="password" autocomplete="new-password" />
          </div>
          <p v-if="formError" class="text-sm text-destructive" role="alert">{{ formError }}</p>
          <p v-if="success" class="text-sm text-success" role="status">Password updated.</p>
          <Button type="submit" :disabled="submitting">Update password</Button>
        </form>
      </CardContent>
    </Card>
    <Card v-if="isDoctor" class="mt-4">
      <CardHeader>
        <CardTitle>My on-call profile</CardTitle>
        <CardDescription>Your doctor profile (read-only).</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="doctorError" class="text-sm text-destructive" role="alert">{{ doctorError }}</p>
        <dl v-else-if="myDoctor" class="grid grid-cols-2 gap-y-2 text-sm">
          <dt class="text-muted-foreground">Email</dt>
          <dd>{{ myDoctor.email }}</dd>
          <dt class="text-muted-foreground">Status</dt>
          <dd>{{ myDoctor.isActive ? 'active' : 'disabled' }}</dd>
          <dt class="text-muted-foreground">Max monthly duties</dt>
          <dd>{{ myDoctor.maxMonthlyDuties }}</dd>
        </dl>
      </CardContent>
    </Card>
  </div>
</template>
