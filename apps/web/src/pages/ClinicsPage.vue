<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Clinic, User } from '@oncall/shared'
import { createClinicSchema, createUserSchema } from '@oncall/shared'
import ClinicSelector from '@/components/layout/ClinicSelector.vue'
import { useClinicSelection } from '@/composables/useClinicSelection'
import { useConfirm } from '@/composables/useConfirm'
import { create as createClinic, list as listClinics, update as updateClinic } from '@/services/clinics'
import { create as createUser, list as listUsers, update as updateUser } from '@/services/user'
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

const clinics = ref<Clinic[]>([])
const admins = ref<User[]>([])
const loading = ref(false)
const errorMsg = ref('')
const { confirm } = useConfirm()
const { selectedClinicId } = useClinicSelection()

const create = ref({ open: false, name: '', errorMsg: '' })
const rename = ref({ open: false, id: 0, currentName: '', name: '', errorMsg: '' })

const adminForm = ref({
  open: false,
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  password: '',
  errorMsg: '',
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    clinics.value = await listClinics()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load clinics'
  } finally {
    loading.value = false
  }
}

async function loadAdmins() {
  const clinicId = selectedClinicId.value
  if (clinicId === undefined) {
    admins.value = []
    return
  }
  try {
    const users = await listUsers(clinicId)
    admins.value = users.filter((u) => u.role === 'administrator')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load administrators'
  }
}

watch(
  selectedClinicId,
  () => {
    void loadAdmins()
  },
  { immediate: true },
)

async function submitCreate() {
  create.value.errorMsg = ''
  const parsed = createClinicSchema.safeParse({ name: create.value.name })
  if (!parsed.success) {
    create.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  try {
    await createClinic(parsed.data)
    create.value = { open: false, name: '', errorMsg: '' }
    await load()
  } catch (e) {
    create.value.errorMsg = e instanceof Error ? e.message : 'Failed to create clinic'
  }
}

function openRename(c: Clinic) {
  rename.value = { open: true, id: c.id, currentName: c.name, name: c.name, errorMsg: '' }
}

async function submitRename() {
  rename.value.errorMsg = ''
  const parsed = createClinicSchema.safeParse({ name: rename.value.name })
  if (!parsed.success) {
    rename.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  try {
    await updateClinic(rename.value.id, { name: parsed.data.name })
    rename.value.open = false
    await load()
  } catch (e) {
    rename.value.errorMsg = e instanceof Error ? e.message : 'Failed to rename clinic'
  }
}

async function toggleActive(c: Clinic) {
  if (c.isActive) {
    const okToDeactivate = await confirm({
      title: 'Deactivate clinic',
      message: `Deactivate ${c.name}? Its users can no longer log in; history stays readable.`,
      confirmText: 'Deactivate',
    })
    if (!okToDeactivate) return
  }
  try {
    await updateClinic(c.id, { isActive: !c.isActive })
    await load()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to update clinic'
  }
}

async function toggleAdminActive(a: User) {
  if (a.isActive) {
    const okToDeactivate = await confirm({
      title: 'Deactivate administrator',
      message: `Deactivate ${a.firstName} ${a.lastName}? They will no longer be able to log in.`,
      confirmText: 'Deactivate',
    })
    if (!okToDeactivate) return
  }
  try {
    await updateUser(a.id, { isActive: !a.isActive })
    await loadAdmins()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to update administrator'
  }
}

async function submitAdmin() {
  adminForm.value.errorMsg = ''
  const clinicId = selectedClinicId.value
  if (clinicId === undefined) {
    adminForm.value.errorMsg = 'Select a clinic first'
    return
  }
  const payload = {
    firstName: adminForm.value.firstName,
    lastName: adminForm.value.lastName,
    email: adminForm.value.email,
    username: adminForm.value.username,
    password: adminForm.value.password,
    role: 'administrator' as const,
    clinicId,
  }
  const parsed = createUserSchema.safeParse(payload)
  if (!parsed.success) {
    adminForm.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  try {
    await createUser(parsed.data)
    adminForm.value = { open: false, firstName: '', lastName: '', email: '', username: '', password: '', errorMsg: '' }
    await loadAdmins()
  } catch (e) {
    adminForm.value.errorMsg = e instanceof Error ? e.message : 'Failed to create administrator'
  }
}

const selectedClinic = () => clinics.value.find((c) => c.id === selectedClinicId.value) ?? null

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Clinics</h1>
      <Button @click="create.open = true">New clinic</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Doctors</TableHead>
          <TableHead>Administrators</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="c in clinics" :key="c.id">
          <TableCell>{{ c.name }}</TableCell>
          <TableCell>
            <span :class="c.isActive ? 'text-emerald-600' : 'text-destructive'">
              {{ c.isActive ? 'Active' : 'Inactive' }}
            </span>
          </TableCell>
          <TableCell>{{ c.doctorCount }}</TableCell>
          <TableCell>{{ c.adminCount }}</TableCell>
          <TableCell class="text-right">
            <div class="flex justify-end gap-2">
              <Button variant="outline" @click="openRename(c)">Rename</Button>
              <Button variant="destructive" @click="toggleActive(c)">
                {{ c.isActive ? 'Deactivate' : 'Reactivate' }}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="create.open" title="New clinic">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="submitCreate">
        <div class="flex flex-col gap-1">
          <Label for="c-name">Name</Label>
          <Input id="c-name" v-model="create.name" />
        </div>
        <p v-if="create.errorMsg" class="text-sm text-destructive" role="alert">{{ create.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>

    <Dialog v-model:open="rename.open" title="Rename clinic">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="submitRename">
        <div class="flex flex-col gap-1">
          <Label for="r-name">Name</Label>
          <Input id="r-name" v-model="rename.name" />
        </div>
        <p v-if="rename.errorMsg" class="text-sm text-destructive" role="alert">{{ rename.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>

    <section class="mt-4 flex flex-col gap-3" data-testid="clinic-admins">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-semibold text-foreground">Administrators</h2>
        <div class="flex items-center gap-2">
          <ClinicSelector />
          <Button :disabled="selectedClinicId === undefined" @click="adminForm.open = true">
            New administrator
          </Button>
        </div>
      </div>
      <p v-if="selectedClinic() === null" class="text-sm text-muted-foreground">
        Select a clinic to manage its administrators.
      </p>
      <p v-else class="text-sm text-muted-foreground">
        Showing administrators of {{ selectedClinic()!.name }}.
      </p>
      <Table v-if="selectedClinic() !== null">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Username</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="a in admins" :key="a.id">
            <TableCell>{{ a.firstName }} {{ a.lastName }}</TableCell>
            <TableCell>{{ a.email }}</TableCell>
            <TableCell>{{ a.username }}</TableCell>
            <TableCell>
              <span :class="a.isActive ? 'text-emerald-600' : 'text-destructive'">
                {{ a.isActive ? 'Active' : 'Inactive' }}
              </span>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="destructive" @click="toggleAdminActive(a)">
                {{ a.isActive ? 'Deactivate' : 'Reactivate' }}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <Dialog v-model:open="adminForm.open" title="New administrator">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="submitAdmin">
        <div class="flex flex-col gap-1">
          <Label for="a-first">First name</Label>
          <Input id="a-first" v-model="adminForm.firstName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="a-last">Last name</Label>
          <Input id="a-last" v-model="adminForm.lastName" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="a-email">Email</Label>
          <Input id="a-email" v-model="adminForm.email" type="email" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="a-username">Username</Label>
          <Input id="a-username" v-model="adminForm.username" autocomplete="username" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="a-password">Password</Label>
          <Input id="a-password" v-model="adminForm.password" type="password" autocomplete="new-password" />
        </div>
        <p v-if="adminForm.errorMsg" class="text-sm text-destructive" role="alert">{{ adminForm.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
