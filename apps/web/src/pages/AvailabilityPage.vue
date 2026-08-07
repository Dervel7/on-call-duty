<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  CreateUnavailabilitySelfRequest,
  Doctor,
  Unavailability,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { createUnavailabilityAdminSchema, updateUnavailabilitySchema } from '@oncall/shared'
import * as unavailabilityService from '@/services/unavailability'
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

const TYPES = ['vacation', 'sick', 'conference', 'other'] as const

const records = ref<Unavailability[]>([])
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')

const filterDoctorId = ref<string>('')
const filterFrom = ref('')
const filterTo = ref('')

interface EditState {
  open: boolean
  id: number | null
  doctorId: string
  type: (typeof TYPES)[number]
  startDate: string
  endDate: string
  note: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  doctorId: '',
  type: 'vacation',
  startDate: '',
  endDate: '',
  note: '',
})
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = {
      doctorId: filterDoctorId.value ? Number(filterDoctorId.value) : undefined,
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
    }
    records.value = await unavailabilityService.listAll(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load availability'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(x: Unavailability) {
  edit.value = {
    open: true,
    id: x.id,
    doctorId: String(x.doctorId),
    type: x.type,
    startDate: x.startDate,
    endDate: x.endDate,
    note: x.note ?? '',
  }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload = {
      doctorId: Number(edit.value.doctorId),
      type: edit.value.type,
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
      note: edit.value.note || undefined,
    }
    const r = createUnavailabilityAdminSchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await unavailabilityService.createForDoctor(r.data.doctorId, {
      type: r.data.type,
      startDate: r.data.startDate,
      endDate: r.data.endDate,
      note: r.data.note,
    })
  } else {
    const payload: UpdateUnavailabilityRequest = {
      type: edit.value.type,
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
      note: edit.value.note === '' ? null : edit.value.note,
    }
    const r = updateUnavailabilitySchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    await unavailabilityService.update(edit.value.id, r.data)
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Unavailability) {
  if (!confirm(`Delete ${x.doctorFirstName} ${x.doctorLastName}'s ${x.type} record?`)) return
  await unavailabilityService.remove(x.id)
  await load()
}

onMounted(async () => {
  try {
    doctors.value = await doctorService.list()
  } catch {
    doctors.value = []
  }
  await load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-doctor">Doctor</Label>
        <select
          id="f-doctor"
          v-model="filterDoctorId"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All</option>
          <option v-for="d in doctors" :key="d.id" :value="d.id">
            {{ d.firstName }} {{ d.lastName }}
          </option>
        </select>
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-from">From</Label>
        <Input id="f-from" v-model="filterFrom" type="date" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-to">To</Label>
        <Input id="f-to" v-model="filterTo" type="date" />
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Doctor</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead>Note</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.doctorFirstName }} {{ x.doctorLastName }}</TableCell>
          <TableCell>{{ x.type }}</TableCell>
          <TableCell>{{ x.startDate }}</TableCell>
          <TableCell>{{ x.endDate }}</TableCell>
          <TableCell>{{ x.note ?? '' }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(x)">Edit</Button>
              <Button size="sm" variant="destructive" @click="remove(x)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New exclusion' : 'Edit exclusion'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-doctor">Doctor</Label>
          <select
            id="e-doctor"
            v-model="edit.doctorId"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>Select a doctor</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.firstName }} {{ d.lastName }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-type">Type</Label>
          <select
            id="e-type"
            v-model="edit.type"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-start">Start date</Label>
          <Input id="e-start" v-model="edit.startDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-end">End date</Label>
          <Input id="e-end" v-model="edit.endDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-note">Note (optional)</Label>
          <Input id="e-note" v-model="edit.note" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
