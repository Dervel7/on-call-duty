import { holidayQuerySchema } from '@oncall/shared'

export { holidayQuerySchema, setMonthHolidaysSchema } from '@oncall/shared'

/** `?clinicId=` of `PUT /holidays/month` (no year: the body carries it). */
export const holidayClinicQuerySchema = holidayQuerySchema.pick({ clinicId: true })
