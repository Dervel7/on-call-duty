export interface BillingState {
  paidThrough: string | null
  locked: boolean
}

/** Days remaining until the billing deadline; null when no deadline is set. */
export interface PaymentAlert {
  daysLeft: number | null
}

export interface UpdateBillingRequest {
  paidThrough: string
}
