export interface BillingState {
  paidThrough: string | null
  locked: boolean
}

export interface UpdateBillingRequest {
  paidThrough: string
}
