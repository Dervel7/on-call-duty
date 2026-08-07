<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'
import { createUserSchema, updateUserSchema } from '@oncall/shared'
import * as userService from '@/services/user'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const users = ref<User[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  email: string
  username: string
  firstName: string
  lastName: string
  role: 'administrator' | 'doctor'
  isActive: boolean
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  username: '',
  firstName: '',
  lastName: '',
  role: 'doctor',
  isActive: true,
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    users.value = await userService.list()
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
  edit.value = {
    open: true,
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload: CreateUserRequest = {
      email: edit.value.email,
      username: edit.value.username,
      password: edit.value.email,
      role: 'administrator',
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
    }
    const r = createUserSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await userService.create(r.data)
  } else {
    const payload: UpdateUserRequest = {
      email: edit.value.email,
      username: edit.value.username,
      role: edit.value.role,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      isActive: edit.value.isActive,
    }
    const r = updateUserSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await userService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function toggleActive(u: User) {
  await userService.update(u.id, { isActive: !u.isActive })
  await load()
}

async function remove(u: User) {
  if (!confirm(`Delete ${u.email}?`)) return
  await userService.remove(u.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Users</h1>
      <Button @click="openCreate">New user</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="u in users" :key="u.id">
          <TableCell>{{ u.firstName }} {{ u.lastName }}</TableCell>
          <TableCell>{{ u.email }}</TableCell>
          <TableCell>{{ u.username }}</TableCell>
          <TableCell>{{ u.role }}</TableCell>
          <TableCell>{{ u.isActive ? 'active' : 'disabled' }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(u)">Edit</Button>
              <Button size="sm" variant="outline" @click="toggleActive(u)">
                {{ u.isActive ? 'Disable' : 'Enable' }}
              </Button>
              <Button size="sm" variant="destructive" @click="remove(u)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New administrator' : 'Edit user'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-email">Email</Label>
          <Input id="e-email" v-model="edit.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-username">Username</Label>
          <Input id="e-username" v-model="edit.username" autocomplete="username" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-first">First name</Label>
          <Input id="e-first" v-model="edit.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-last">Last name</Label>
          <Input id="e-last" v-model="edit.lastName" />
        </div>
        <div v-if="edit.id !== null" class="flex flex-col gap-1">
          <Label for="e-role">Role</Label>
          <Select id="e-role" v-model="edit.role">
            <option value="doctor">doctor</option>
            <option value="administrator">administrator</option>
          </Select>
        </div>
        <p v-if="edit.id === null" class="text-xs text-muted-foreground">
          Initial password equals the email. The administrator should change it on first login.
        </p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
