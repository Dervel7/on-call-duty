export interface BillingState {
  paidThrough: string | null
  locked: boolean
}

/** Days remaining until the billing deadline; null when no deadline is set. */
export interface PaymentAlert {
  daysLeft: number | null
}

/**
 * Open on-call cycle: `anchorDate` is the first open on-call day and every
 * `intervalDays`-th day after it is open too; all other days are closed.
 */
export interface OpenDutySettings {
  anchorDate: string
  intervalDays: number
}

export interface UpdateOpenDutyRequest {
  intervalDays: number
}

export interface UpdateBillingRequest {
  paidThrough: string
}

/**
 * On-call capacity per day type: how many doctors a single day holds. Each
 * clinic sets its own counts. Open days follow the cycle above; the calendar
 * day right after an open day is a post-open day; every other day is closed.
 */
export interface DutySlotsSettings {
  openDutySlots: number
  postOpenDutySlots: number
  closedDutySlots: number
}

/** A clinic's slot counts plus its active doctor count — the ceiling for both. */
export interface ClinicDutySlots extends DutySlotsSettings {
  activeDoctors: number
}

export interface UpdateDutySlotsRequest {
  openDutySlots: number
  postOpenDutySlots: number
  closedDutySlots: number
}

/**
 * Hard minimum of on-call doctors per day type. A day is acceptable with any
 * count from its minimum up to its slot count; the full slot count is the
 * preferred outcome. Always 1 ≤ minimum ≤ the matching slot count.
 */
export interface DutyMinimumSettings {
  openDutyMinimum: number
  postOpenDutyMinimum: number
  closedDutyMinimum: number
}

export interface UpdateDutyMinimumsRequest {
  openDutyMinimum: number
  postOpenDutyMinimum: number
  closedDutyMinimum: number
}
