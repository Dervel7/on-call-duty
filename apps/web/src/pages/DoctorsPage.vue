<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'
import { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  email: string
  firstName: string
  lastName: string
  maxMonthlyDuties: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  email: '',
  firstName: '',
  lastName: '',
  maxMonthlyDuties: '7',
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    doctors.value = await doctorService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load doctors'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(d: Doctor) {
  edit.value = {
    open: true,
    id: d.id,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
    maxMonthlyDuties: String(d.maxMonthlyDuties),
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload: CreateDoctorRequest = {
      email: edit.value.email,
      password: edit.value.email,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = createDoctorSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await doctorService.create(r.data)
  } else {
    const payload: UpdateDoctorRequest = {
      email: edit.value.email,
      firstName: edit.value.firstName,
      lastName: edit.value.lastName,
      maxMonthlyDuties: Number(edit.value.maxMonthlyDuties),
    }
    const r = updateDoctorSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await doctorService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function toggleActive(d: Doctor) {
  await doctorService.update(d.id, { isActive: !d.isActive })
  await load()
}

async function remove(d: Doctor) {
  if (!confirm(`Delete doctor ${d.email}? This removes their account too.`)) return
  await doctorService.remove(d.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Doctors</h1>
      <Button @click="openCreate">New doctor</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Max monthly duties</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="d in doctors" :key="d.id">
          <TableCell>{{ d.firstName }} {{ d.lastName }}</TableCell>
          <TableCell>{{ d.email }}</TableCell>
          <TableCell>{{ d.isActive ? 'active' : 'disabled' }}</TableCell>
          <TableCell>{{ d.maxMonthlyDuties }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(d)">Edit</Button>
              <Button size="sm" variant="outline" @click="toggleActive(d)">
                {{ d.isActive ? 'Disable' : 'Enable' }}
              </Button>
              <Button size="sm" variant="destructive" @click="remove(d)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New doctor' : 'Edit doctor'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="d-email">Email</Label>
          <Input id="d-email" v-model="edit.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-first">First name</Label>
          <Input id="d-first" v-model="edit.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-last">Last name</Label>
          <Input id="d-last" v-model="edit.lastName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="d-max">Max monthly duties (1–7)</Label>
          <Input id="d-max" v-model="edit.maxMonthlyDuties" type="number" />
        </div>
        <p v-if="edit.id === null" class="text-xs text-muted-foreground">
          Initial password equals the email. The doctor should change it on first login.
        </p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
