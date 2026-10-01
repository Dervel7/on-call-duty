<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type {
  CreateDoctorRequest,
  Doctor,
  Role,
  UpdateDoctorRequest,
  UpdateUserRequest,
  User,
} from '@oncall/shared'
import {
  createDoctorSchema,
  resetUserPasswordSchema,
  updateDoctorSchema,
  updateUserSchema,
  usernameSchema,
} from '@oncall/shared'
import * as doctorService from '@/services/doctor'
import * as userService from '@/services/user'
import { Users } from 'lucide-vue-next'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import { useConfirm } from '@/composables/useConfirm'

// Every account created through this form starts with the same initial
// password; the user must change it on first login.
const INITIAL_PASSWORD = 'changeme123'

const users = ref<User[]>([])
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
/** In-flight flags: edit dialog, reset dialog, and the row whose action runs. */
const saving = ref(false)
const resetting = ref(false)
const busyUserId = ref<number | null>(null)
const { confirm } = useConfirm()

const doctorByUserId = computed(() => {
  const map = new Map<number, Doctor>()
  for (const d of doctors.value) map.set(d.userId, d)
  return map
})

// Only doctors, always ordered by last name. The sort is derived here, never
// stored, so no action can reshuffle the list.
const visibleUsers = computed(() =>
  users.value
    .filter((u) => u.role === 'doctor')
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
)

interface EditState {
  open: boolean
  id: number | null
  doctorId: number | null
  email: string
  username: string
  firstName: string
  lastName: string
  role: Role
  maxMonthlyDuties: string
  errorMsg: string
  // True once the admin typed in the username field; stops auto-generation.
  usernameEdited: boolean
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  doctorId: null,
  email: '',
  username: '',
  firstName: '',
  lastName: '',
  role: 'doctor',
  maxMonthlyDuties: '7',
  errorMsg: '',
  usernameEdited: false,
})
const edit = ref<EditState>(emptyEdit())

// Username convention for new doctor accounts: first 3 letters of the first
// name followed by the first 3 letters of the last name, lowercased. Accents
// are stripped and any character usernameSchema rejects is dropped.
function generatedUsername(): string {
  return (edit.value.firstName.slice(0, 3) + edit.value.lastName.slice(0, 3))
    .normalize('NFD')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .toLowerCase()
}

watch(
  () => [edit.value.firstName, edit.value.lastName],
  () => {
    if (edit.value.id === null && !edit.value.usernameEdited) edit.value.username = generatedUsername()
  },
)

function onUsernameInput(value: string | number) {
  edit.value.username = String(value)
  if (edit.value.id === null) edit.value.usernameEdited = true
}

interface ResetState {
  open: boolean
  password: string
  errorMsg: string
}

const emptyReset = (): ResetState => ({
  open: false,
  password: '',
  errorMsg: '',
})
const reset = ref<ResetState>(emptyReset())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    ;[users.value, doctors.value] = await Promise.all([userService.list(), doctorService.list()])
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load users'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(u: User) {
  const d = doctorByUserId.value.get(u.id)
  edit.value = {
    open: true,
    id: u.id,
    doctorId: d?.id ?? null,
    email: u.email,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    maxMonthlyDuties: d ? String(d.maxMonthlyDuties) : '7',
    errorMsg: '',
    usernameEdited: false,
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await persistEdit()
  } finally {
    saving.value = false
  }
}

async function persistEdit() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const u = usernameSchema.safeParse(edit.value.username)
    if (!u.success) {
      edit.value.errorMsg = 'Username must be 3–32 characters: letters, digits, dot, underscore or hyphen'
      return
    }
    const payload: CreateDoctorRequest = {
      email: edit.value.email,
      username: u.data,
      password: INITIAL_PASSWORD,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = createDoctorSchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await doctorService.create(r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to save user'
      return
    }
  } else if (edit.value.doctorId !== null) {
    const payload: UpdateDoctorRequest = {
      email: edit.value.email,
      username: edit.value.username,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = updateDoctorSchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await doctorService.update(edit.value.doctorId, r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to save user'
      return
    }
  } else {
    const payload: UpdateUserRequest = {
      email: edit.value.email,
      username: edit.value.username,
      role: edit.value.role,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
    }
    const r = updateUserSchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await userService.update(edit.value.id, r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to save user'
      return
    }
  }
  edit.value = emptyEdit()
  await load()
}

function openReset() {
  reset.value = { ...emptyReset(), open: true }
}

async function savePassword() {
  if (resetting.value) return
  const r = resetUserPasswordSchema.safeParse({ newPassword: reset.value.password })
  if (!r.success) {
    reset.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  resetting.value = true
  try {
    await userService.resetPassword(edit.value.id!, reset.value.password)
  } catch (e) {
    reset.value.errorMsg = e instanceof Error ? e.message : 'Failed to reset password'
    return
  } finally {
    resetting.value = false
  }
  reset.value = emptyReset()
}

async function toggleActive(u: User) {
  if (busyUserId.value !== null) return
  busyUserId.value = u.id
  try {
    await userService.update(u.id, { isActive: !u.isActive })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to update user'
    return
  } finally {
    busyUserId.value = null
  }
  await load()
}

async function remove(u: User) {
  if (busyUserId.value !== null) return
  const d = doctorByUserId.value.get(u.id)
  const message = d
    ? `Delete doctor ${u.email}? They will be permanently hidden from the list. Past duties in published schedules are kept. This cannot be undone.`
    : `Delete ${u.email}?`
  if (!(await confirm({ title: 'Delete user', message, confirmText: 'Delete' }))) return
  busyUserId.value = u.id
  try {
    if (d) await doctorService.remove(d.id)
    else await userService.remove(u.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete user'
    return
  } finally {
    busyUserId.value = null
  }
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="Users" title="Users" subtitle="Manage doctor accounts and duty caps">
      <template #actions>
        <Button @click="openCreate">New user</Button>
      </template>
    </PageHeader>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner :size="16" />
      Loading…
    </div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <p class="hud-label mb-2">DIRECTORY</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Max monthly duties</TableHead>
          <TableHead>Status</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="u in visibleUsers" :key="u.id" :class="u.isActive ? undefined : 'bg-destructive/[0.06]'">
          <TableCell>
            <span class="flex items-center gap-2.5">
              <Avatar :name="`${u.firstName} ${u.lastName}`" size="sm" />
              {{ u.firstName }} {{ u.lastName }}
            </span>
          </TableCell>
          <TableCell>{{ u.email }}</TableCell>
          <TableCell>{{ u.username }}</TableCell>
          <TableCell>
            <Badge variant="outline">{{ u.role }}</Badge>
          </TableCell>
          <TableCell class="font-mono text-sm">{{ doctorByUserId.get(u.id)?.maxMonthlyDuties ?? '—' }}</TableCell>
          <TableCell>
            <Badge :variant="u.isActive ? 'success' : 'neutral'" dot>{{ u.isActive ? 'active' : 'disabled' }}</Badge>
          </TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(u)">Edit</Button>
              <Button size="sm" variant="outline" :disabled="busyUserId === u.id" @click="toggleActive(u)">
                {{ u.isActive ? 'Disable' : 'Enable' }}
              </Button>
              <Button size="sm" variant="destructive" :disabled="busyUserId === u.id" @click="remove(u)">
                Delete
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New user' : 'Edit user'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-email">Email</Label>
          <Input id="e-email" v-model="edit.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-username">Username</Label>
          <Input
            id="e-username"
            :model-value="edit.username"
            autocomplete="username"
            @update:model-value="onUsernameInput"
          />
          <p v-if="edit.id === null" class="text-xs text-muted-foreground">
            Generated from the doctor's name (first 3 letters of each). Edit it if it is already taken.
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-first">First name</Label>
          <Input id="e-first" v-model="edit.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-last">Last name</Label>
          <Input id="e-last" v-model="edit.lastName" />
        </div>
        <div v-if="edit.doctorId !== null || edit.id === null" class="flex flex-col gap-1">
          <Label for="e-max">Max monthly duties (1–7)</Label>
          <Input id="e-max" v-model="edit.maxMonthlyDuties" type="number" />
        </div>
        <p v-if="edit.id === null" class="text-xs text-muted-foreground">
          Initial password is changeme123. The user should change it on first login.
        </p>
        <p v-if="edit.errorMsg" class="text-sm text-destructive" role="alert">{{ edit.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button v-if="edit.id !== null" type="button" variant="outline" :disabled="saving" @click="openReset">
            Reset Password
          </Button>
          <Button type="submit" :disabled="saving">Save</Button>
        </div>
      </form>
    </Dialog>

    <Dialog v-model:open="reset.open" title="Reset password">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="savePassword">
        <p class="text-sm text-muted-foreground">
          Set a new password for this user. The current password is not needed.
        </p>
        <div class="flex flex-col gap-1">
          <Label for="r-password">New password</Label>
          <Input id="r-password" v-model="reset.password" type="password" autocomplete="new-password" />
        </div>
        <p v-if="reset.errorMsg" class="text-sm text-destructive" role="alert">{{ reset.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit" :disabled="resetting">Confirm</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
