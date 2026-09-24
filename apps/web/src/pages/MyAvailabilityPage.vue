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
import DatePicker from '@/components/ui/DatePicker.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import { useConfirm } from '@/composables/useConfirm'

const records = ref<Unavailability[]>([])
const loading = ref(false)
const errorMsg = ref('')
const { confirm } = useConfirm()

interface EditState {
  open: boolean
  id: number | null
  startDate: string
  endDate: string
  errorMsg: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  startDate: '',
  endDate: '',
  errorMsg: '',
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
    startDate: x.startDate,
    endDate: x.endDate,
    errorMsg: '',
  }
}

async function save() {
  edit.value.errorMsg = ''
  const base = {
    startDate: edit.value.startDate,
    endDate: edit.value.endDate,
  }
  if (edit.value.id === null) {
    const r = createUnavailabilitySelfSchema.safeParse(base)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    const payload: CreateUnavailabilitySelfRequest = {
      startDate: r.data.startDate,
      endDate: r.data.endDate,
    }
    try {
      await unavailabilityService.createMine(payload)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to create availability'
      return
    }
  } else {
    const payload: UpdateUnavailabilityRequest = {
      startDate: edit.value.startDate,
      endDate: edit.value.endDate,
    }
    const r = updateUnavailabilitySchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await unavailabilityService.update(edit.value.id, r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to update availability'
      return
    }
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Unavailability) {
  if (
    !(await confirm({
      title: 'Delete record',
      message: `Delete your exclusion (${x.startDate} → ${x.endDate})?`,
      confirmText: 'Delete',
    }))
  )
    return
  try {
    await unavailabilityService.remove(x.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete availability'
    return
  }
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
          <TableHead>Start</TableHead>
          <TableHead>End</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.startDate }}</TableCell>
          <TableCell>{{ x.endDate }}</TableCell>
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
          <Label for="m-start">Start date</Label>
          <DatePicker id="m-start" v-model="edit.startDate" placeholder="Pick a date" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="m-end">End date</Label>
          <DatePicker id="m-end" v-model="edit.endDate" placeholder="Pick a date" />
        </div>
        <p v-if="edit.errorMsg" class="text-sm text-destructive" role="alert">{{ edit.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
