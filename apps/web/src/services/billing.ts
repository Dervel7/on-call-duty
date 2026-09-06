import type { BillingState, PaymentAlert } from '@oncall/shared'
import { apiGet, apiPatch } from '@/lib/http'

export async function state(): Promise<BillingState> {
  const { billing } = await apiGet<{ billing: BillingState }>('/billing')
  return billing
}
export async function paymentAlert(): Promise<PaymentAlert> {
  const { paymentAlert: alert } = await apiGet<{ paymentAlert: PaymentAlert }>(
    '/billing/payment-alert',
  )
  return alert
}
export async function update(paidThrough: string): Promise<BillingState> {
  const { billing } = await apiPatch<{ billing: BillingState }>('/billing', { paidThrough })
  return billing
}
