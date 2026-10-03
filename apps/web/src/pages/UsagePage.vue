<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BillingState, GenerationEvent, OperatorAlert } from '@oncall/shared'
import { updateBillingSchema } from '@oncall/shared'
import { toIsoDate } from '@oncall/utils'
import { Gauge } from 'lucide-vue-next'
import * as billingService from '@/services/billing'
import * as usageService from '@/services/usage'
import { useConfirm } from '@/composables/useConfirm'
import { useIntlLocale } from '@/composables/useIntlLocale'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import Label from '@/components/ui/Label.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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
const { t } = useI18n()
const intlLocale = useIntlLocale()

const openAlerts = computed(() => alerts.value.filter((a) => a.resolvedAt === null).length)
// Resolve buttons stay disabled until the list is reloaded, so a double click cannot send a
// second request whose 409 would show "already resolved" after a successful resolve.
const resolving = ref(false)

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
    errorMsg.value = e instanceof Error ? e.message : t('usage.loadFailed')
  } finally {
    loading.value = false
  }
}

async function resolve(a: OperatorAlert) {
  if (resolving.value) return
  resolving.value = true
  try {
    await usageService.resolveAlert(a.id)
    await load()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('usage.resolveFailed')
  } finally {
    resolving.value = false
  }
}

async function loadBilling() {
  billingError.value = ''
  try {
    billing.value = await billingService.state()
    billingDate.value = billing.value.paidThrough ?? ''
  } catch (e) {
    billingError.value = e instanceof Error ? e.message : t('usage.billingLoadFailed')
  }
}

async function saveBilling() {
  billingError.value = ''
  const r = updateBillingSchema.safeParse({ paidThrough: billingDate.value })
  if (!r.success) {
    billingError.value = t('usage.invalidPaidThrough')
    return
  }
  if (r.data.paidThrough < toIsoDate(new Date())) {
    const ok = await confirm({
      title: t('usage.lockTitle'),
      message: t('usage.lockMessage', { date: r.data.paidThrough }),
      confirmText: t('usage.lockConfirm'),
    })
    if (!ok) return
  }
  billingSaving.value = true
  try {
    billing.value = await billingService.update(r.data.paidThrough)
    billingDate.value = billing.value.paidThrough ?? ''
  } catch (e) {
    billingError.value = e instanceof Error ? e.message : t('usage.billingUpdateFailed')
  } finally {
    billingSaving.value = false
  }
}

function monthLabel(e: GenerationEvent): string {
  return `${e.year}-${String(e.month).padStart(2, '0')}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale.value)
}

function overlapLabel(e: GenerationEvent): string {
  return e.overlapPercent === null ? '—' : e.overlapPercent + '%'
}

onMounted(load)
onMounted(loadBilling)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="Gauge" :title="t('nav.usage')" :subtitle="t('usage.subtitle')" />

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner :size="16" /> {{ t('common.loading') }}</div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('usage.billing') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <p v-if="billing" class="text-sm text-muted-foreground">
            {{ t('usage.paidThrough') }}:
            <span class="font-mono text-foreground">{{ billing.paidThrough ?? t('usage.notSet') }}</span>
          </p>
          <Badge v-if="billing" :variant="billing.locked ? 'destructive' : 'success'" dot>
            {{ billing.locked ? t('usage.locked') : t('usage.active') }}
          </Badge>
        </div>
        <form class="flex items-end gap-2" novalidate @submit.prevent="saveBilling">
          <div class="flex flex-col gap-1">
            <Label for="billing-date">{{ t('usage.paidThrough') }}</Label>
            <DatePicker id="billing-date" v-model="billingDate" :placeholder="t('usage.pickDate')" class="w-44" />
          </div>
          <Button type="submit" :disabled="billingSaving">{{ t('common.save') }}</Button>
        </form>
        <p v-if="billingError" class="text-sm text-destructive" role="alert">{{ billingError }}</p>
      </CardContent>
    </Card>

    <Card class="hud-corners">
      <CardHeader>
        <CardTitle>{{ t('usage.overview') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">
          {{ t('usage.openAlerts') }}:
          <span class="font-mono text-foreground">{{ openAlerts }}</span>
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('usage.generationHistory') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState v-if="!loading && !errorMsg && generations.length === 0" :title="t('usage.noGenerations')" />
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('usage.generatedAt') }}</TableHead>
              <TableHead>{{ t('common.month') }}</TableHead>
              <TableHead>{{ t('usage.doctors') }}</TableHead>
              <TableHead>{{ t('usage.overlap') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="e in generations" :key="`${e.generatedAt}-${e.year}-${e.month}`">
            <TableCell class="font-mono text-xs text-muted-foreground">{{ formatTime(e.generatedAt) }}</TableCell>
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
        <CardTitle>{{ t('usage.alerts') }}</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState v-if="!loading && !errorMsg && alerts.length === 0" :title="t('usage.noAlerts')" />
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('usage.created') }}</TableHead>
              <TableHead>{{ t('usage.type') }}</TableHead>
              <TableHead>{{ t('usage.detail') }}</TableHead>
              <TableHead>{{ t('usage.state') }}</TableHead>
              <TableHead class="text-right">{{ t('usage.action') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in alerts" :key="a.id">
            <TableCell class="font-mono text-xs text-muted-foreground">{{ formatTime(a.createdAt) }}</TableCell>
              <TableCell>{{ a.type }}</TableCell>
              <TableCell>{{ JSON.stringify(a.detail) }}</TableCell>
              <TableCell><Badge :variant="a.resolvedAt ? 'neutral' : 'warning'">{{ a.resolvedAt ? t('usage.resolved') : t('usage.open') }}</Badge></TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" :disabled="a.resolvedAt !== null || resolving" @click="resolve(a)">
                  {{ t('usage.resolve') }}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
