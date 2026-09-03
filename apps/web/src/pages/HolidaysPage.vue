<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateHolidayRequest, Holiday, UpdateHolidayRequest } from '@oncall/shared'
import { createHolidaySchema, updateHolidaySchema } from '@oncall/shared'
import * as holidayService from '@/services/holiday'
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
import { useConfirm } from '@/composables/useConfirm'

const records = ref<Holiday[]>([])
const loading = ref(false)
const errorMsg = ref('')
const { confirm } = useConfirm()

interface EditState {
  open: boolean
  id: number | null
  name: string
  date: string
  errorMsg: string
}
const emptyEdit = (): EditState => ({ open: false, id: null, name: '', date: '', errorMsg: '' })
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await holidayService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load holidays'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}
function openUpdate(x: Holiday) {
  edit.value = { open: true, id: x.id, name: x.name, date: x.date, errorMsg: '' }
}

async function save() {
  edit.value.errorMsg = ''
  if (edit.value.id === null) {
    const payload: CreateHolidayRequest = { name: edit.value.name, date: edit.value.date }
    const r = createHolidaySchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await holidayService.create(r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to create holiday'
      return
    }
  } else {
    const payload: UpdateHolidayRequest = { name: edit.value.name, date: edit.value.date }
    const r = updateHolidaySchema.safeParse(payload)
    if (!r.success) {
      edit.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await holidayService.update(edit.value.id, r.data)
    } catch (e) {
      edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to update holiday'
      return
    }
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Holiday) {
  if (
    !(await confirm({
      title: 'Delete holiday',
      message: `Delete holiday "${x.name}" on ${x.date}?`,
      confirmText: 'Delete',
    }))
  )
    return
  try {
    await holidayService.remove(x.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete holiday'
    return
  }
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Holidays</h1>
      <Button @click="openCreate">New holiday</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Name</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.date }}</TableCell>
          <TableCell>{{ x.name }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(x)">Edit</Button>
              <Button size="sm" variant="destructive" @click="remove(x)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New holiday' : 'Edit holiday'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-name">Name</Label>
          <Input id="e-name" v-model="edit.name" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-date">Date</Label>
          <Input id="e-date" v-model="edit.date" type="date" />
        </div>
        <p v-if="edit.errorMsg" class="text-sm text-destructive" role="alert">{{ edit.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
