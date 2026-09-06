<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BillingState, GenerationEvent, OperatorAlert } from '@oncall/shared'
import * as billingService from '@/services/billing'
import * as usageService from '@/services/usage'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const generations = ref<GenerationEvent[]>([])
const alerts = ref<OperatorAlert[]>([])
const loading = ref(false)
const errorMsg = ref('')

const billing = ref<BillingState | null>(null)
const billingDate = ref('')
const billingSaving = ref(false)
const billingError = ref('')

const openAlerts = computed(() => alerts.value.filter((a) => a.resolvedAt === null).length)

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [g, a] = await Promise.all([
      usageService.generations(),
      usageService.alerts(),
    ])
    generations.value = g
    alerts.value = a
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load usage data'
  } finally {
    loading.value = false
  }
}

async function resolve(a: OperatorAlert) {
  try {
    await usageService.resolveAlert(a.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to resolve alert'
    return
  }
  await load()
}

async function loadBilling() {
  billingError.value = ''
  try {
    billing.value = await billingService.state()
    billingDate.value = billing.value.paidThrough ?? ''
  } catch (e) {
    billingError.value = e instanceof Error ? e.message : 'Failed to load billing state'
  }
}

async function saveBilling() {
  billingError.value = ''
  billingSaving.value = true
  try {
    billing.value = await billingService.update(billingDate.value)
    billingDate.value = billing.value.paidThrough ?? ''
  } catch (e) {
    billingError.value = e instanceof Error ? e.message : 'Failed to update billing'
  } finally {
    billingSaving.value = false
  }
}

function monthLabel(e: GenerationEvent): string {
  return `${e.year}-${String(e.month).padStart(2, '0')}`
}

function overlapLabel(e: GenerationEvent): string {
  return e.overlapPercent === null ? '—' : e.overlapPercent + '%'
}

onMounted(load)
onMounted(loadBilling)
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold text-foreground">Usage</h1>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <p class="text-sm text-muted-foreground">
            Paid through:
            <span class="text-foreground">{{ billing?.paidThrough ?? 'Not set' }}</span>
          </p>
          <span
            v-if="billing"
            :class="[
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              billing.locked ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            ]">
            {{ billing.locked ? 'Locked' : 'Active' }}
          </span>
        </div>
        <form class="flex items-end gap-2" novalidate @submit.prevent="saveBilling">
          <div class="flex flex-col gap-1">
            <Label for="billing-date">Paid through</Label>
            <Input id="billing-date" v-model="billingDate" type="date" />
          </div>
          <Button type="submit" :disabled="billingSaving">Save</Button>
        </form>
        <p v-if="billingError" class="text-sm text-destructive" role="alert">{{ billingError }}</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          Open alerts:
          <span class="text-foreground">{{ openAlerts }}</span>
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Generation history</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Generated at</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Doctors</TableHead>
              <TableHead>Overlap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(e, i) in generations" :key="i">
              <TableCell>{{ new Date(e.generatedAt).toLocaleString() }}</TableCell>
              <TableCell>{{ monthLabel(e) }}</TableCell>
              <TableCell>{{ e.doctorNames.join(', ') }}</TableCell>
              <TableCell>{{ overlapLabel(e) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>State</TableHead>
              <TableHead class="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in alerts" :key="a.id">
              <TableCell>{{ new Date(a.createdAt).toLocaleString() }}</TableCell>
              <TableCell>{{ a.type }}</TableCell>
              <TableCell>{{ JSON.stringify(a.detail) }}</TableCell>
              <TableCell>{{ a.resolvedAt ? 'resolved' : 'open' }}</TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" :disabled="a.resolvedAt !== null" @click="resolve(a)">
                  Resolve
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
