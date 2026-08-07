import { z } from 'zod'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')
const yearMonth = {
  year: z.number().int().min(1970).max(2100),
  month: z.number().int().min(1).max(12),
}

export const createScheduleSchema = z.object(yearMonth)
export const scheduleQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
export const holidayQuerySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
})
export const createHolidaySchema = z.object({
  name: z.string().min(1).max(200),
  date: dateStr,
})
export const updateHolidaySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  date: dateStr.optional(),
})
export const createDutySchema = z.object({
  date: dateStr,
  doctorId: z.number().int().positive(),
})
export const reassignDutySchema = z.object({
  doctorId: z.number().int().positive(),
})
