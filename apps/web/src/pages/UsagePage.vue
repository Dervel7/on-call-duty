<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BillingState, GenerationEvent, OperatorAlert } from '@oncall/shared'
import { updateBillingSchema } from '@oncall/shared'
import { toIsoDate } from '@oncall/utils'
import { Gauge } from 'lucide-vue-next'
import * as billingService from '@/services/billing'
import * as usageService from '@/services/usage'
import { useConfirm } from '@/composables/useConfirm'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'
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
const { confirm } = useConfirm()

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
  const r = updateBillingSchema.safeParse({ paidThrough: billingDate.value })
  if (!r.success) {
    billingError.value = 'Pick a valid paid-through date'
    return
  }
  if (r.data.paidThrough < toIsoDate(new Date())) {
    const ok = await confirm({
      title: 'Lock the system?',
      message: `${r.data.paidThrough} is in the past. Saving it locks every user out until a later date is set.`,
      confirmText: 'Lock system',
    })
    if (!ok) return
  }
  billingSaving.value = true
  try {
    billing.value = await billingService.update(r.data.paidThrough)
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
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="Gauge" title="Usage" subtitle="Billing, generations, and alerts" />

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner :size="16" /> Loading…</div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <p class="text-sm text-muted-foreground">
            Paid through:
            <span class="font-mono text-foreground">{{ billing?.paidThrough ?? 'Not set' }}</span>
          </p>
          <Badge v-if="billing" :variant="billing.locked ? 'destructive' : 'success'" dot>
            {{ billing.locked ? 'Locked' : 'Active' }}
          </Badge>
        </div>
        <form class="flex items-end gap-2" novalidate @submit.prevent="saveBilling">
          <div class="flex flex-col gap-1">
            <Label for="billing-date">Paid through</Label>
            <DatePicker id="billing-date" v-model="billingDate" placeholder="Pick a date" class="w-44" />
          </div>
          <Button type="submit" :disabled="billingSaving">Save</Button>
        </form>
        <p v-if="billingError" class="text-sm text-destructive" role="alert">{{ billingError }}</p>
      </CardContent>
    </Card>

    <Card class="hud-corners">
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          Open alerts:
          <span class="font-mono text-foreground">{{ openAlerts }}</span>
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
            <TableCell class="font-mono text-xs text-muted-foreground">{{ new Date(e.generatedAt).toLocaleString() }}</TableCell>
            <TableCell class="font-mono text-xs">{{ monthLabel(e) }}</TableCell>
              <TableCell>{{ e.doctorNames.join(', ') }}</TableCell>
            <TableCell class="font-mono text-xs">{{ overlapLabel(e) }}</TableCell>
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
            <TableCell class="font-mono text-xs text-muted-foreground">{{ new Date(a.createdAt).toLocaleString() }}</TableCell>
              <TableCell>{{ a.type }}</TableCell>
              <TableCell>{{ JSON.stringify(a.detail) }}</TableCell>
              <TableCell><Badge :variant="a.resolvedAt ? 'neutral' : 'warning'">{{ a.resolvedAt ? 'resolved' : 'open' }}</Badge></TableCell>
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
