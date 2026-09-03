import { SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import type { DateAvailability } from './scheduleTypes'

export function extraDateKey(extra: DateAvailability) {
  return String(extra.availability_date).slice(0, 10)
}

export function normalizeExtraMinute(value: number | string) {
  return Number(value)
}

export function normalizeDateExtras(dateExtras: DateAvailability[]): DateAvailability[] {
  return dateExtras.map((extra) => ({
    availability_date: extraDateKey(extra),
    start_minutes: normalizeExtraMinute(extra.start_minutes),
  }))
}

export type ContiguousExtra = {
  dateKey: string
  startMinutes: number
  endMinutes: number
  slots: Array<{ availability_date: string; start_minutes: number }>
}

export function findContiguousExtra(
  dateKey: string,
  startMinutes: number,
  dateExtras: DateAvailability[],
): ContiguousExtra | null {
  const normalized = normalizeDateExtras(dateExtras)
  const dayExtras = normalized.filter((e) => e.availability_date === dateKey)
  const extraMinutes = new Set(dayExtras.map((e) => e.start_minutes))

  if (!extraMinutes.has(startMinutes)) return null

  let rangeStart = startMinutes
  let rangeEnd = startMinutes

  while (extraMinutes.has(rangeStart - SLOT_INTERVAL_MINUTES)) {
    rangeStart -= SLOT_INTERVAL_MINUTES
  }
  while (extraMinutes.has(rangeEnd + SLOT_INTERVAL_MINUTES)) {
    rangeEnd += SLOT_INTERVAL_MINUTES
  }

  const slots = dayExtras
    .filter((e) => e.start_minutes >= rangeStart && e.start_minutes <= rangeEnd)
    .map((e) => ({
      availability_date: e.availability_date,
      start_minutes: e.start_minutes,
    }))

  return {
    dateKey,
    startMinutes: rangeStart,
    endMinutes: rangeEnd + SLOT_INTERVAL_MINUTES,
    slots,
  }
}
