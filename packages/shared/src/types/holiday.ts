export interface Holiday {
  id: number
  clinicId: number
  date: string
}

export interface HolidayQuery {
  year: number
  clinicId?: number
}

export interface SetMonthHolidaysRequest {
  year: number
  month: number
  dates: string[]
}
