<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type {
  CreateUnavailabilitySelfRequest,
  Unavailability,
  UpdateUnavailabilityRequest,
} from '@oncall/shared'
import { createUnavailabilitySelfSchema, updateUnavailabilitySchema } from '@oncall/shared'
import * as unavailabilityService from '@/services/unavailability'
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

const TYPES = ['vacation', 'sick', 'conference', 'other'] as const

const records = ref<Unavailability[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  type: (typeof TYPES)[number]
  startDate: string
  endDate: string
  note: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
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
    records.value = await unavailabilityService.listMine()
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
    type: x.type,
    startDate: x.startDate,
    endDate: x.endDate,
    note: x.note ?? '',
  }
}

async function save() {
  errorMsg.value = ''
  const base = {
    type: edit.value.type,
    startDate: edit.value.startDate,
    endDate: edit.value.endDate,
    note: edit.value.note || undefined,
  }
  if (edit.value.id === null) {
    const r = createUnavailabilitySelfSchema.safeParse(base)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    const payload: CreateUnavailabilitySelfRequest = {
      type: r.data.type,
      startDate: r.data.startDate,
      endDate: r.data.endDate,
      note: r.data.note,
    }
    await unavailabilityService.createMine(payload)
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
  if (!confirm(`Delete your ${x.type} record (${x.startDate} → ${x.endDate})?`)) return
  await unavailabilityService.remove(x.id)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">My availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead>Note</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
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
          <Label for="m-type">Type</Label>
          <Select id="m-type" v-model="edit.type">
            <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-start">Start date</Label>
          <Input id="m-start" v-model="edit.startDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-end">End date</Label>
          <Input id="m-end" v-model="edit.endDate" type="date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-note">Note (optional)</Label>
          <Input id="m-note" v-model="edit.note" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
