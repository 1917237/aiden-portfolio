import { TUTOR_SCHEDULE_TIMEZONE } from './config'
import { SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import { cellKey, parseCellKey } from './scheduleConfig'
import {
  addDaysToDateKey,
  dayOfWeekFromDateKey,
  getDateKeyInTimezone,
  isoToZonedParts,
  startOfWeekFromDateKey,
  zonedCivilToIso,
} from './timezoneUtils'

/** Convert a civil date/time in one zone to civil date/time in another. */
export function mapCivilBetweenZones(
  dateKey: string,
  startMinutes: number,
  fromTimeZone: string,
  toTimeZone: string,
) {
  const iso = zonedCivilToIso(dateKey, startMinutes, fromTimeZone)
  const parts = isoToZonedParts(iso, toTimeZone)
  return {
    dateKey: parts.dateKey,
    startMinutes: parts.startMinutes,
    dayOfWeek: dayOfWeekFromDateKey(parts.dateKey),
    iso,
  }
}

export function displayToTutorCivil(
  dateKey: string,
  startMinutes: number,
  displayTimeZone: string,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
) {
  return mapCivilBetweenZones(dateKey, startMinutes, displayTimeZone, tutorTimeZone)
}

export function zonedRangeToIso(
  startDateKey: string,
  startMinutes: number,
  endDateKey: string,
  endMinutes: number,
  timeZone: string,
) {
  const startIso = zonedCivilToIso(startDateKey, startMinutes, timeZone)
  const endIso = zonedCivilToIso(endDateKey, endMinutes, timeZone)
  return { startIso, endIso }
}

/**
 * Walk a half-open [start, end) range in a timezone and return each 15-min civil
 * slot in the target timezone (usually tutor schedule TZ for storage).
 */
export function each15MinSlotMapped(
  startDateKey: string,
  startMinutes: number,
  endDateKey: string,
  endMinutes: number,
  fromTimeZone: string,
  toTimeZone: string,
) {
  const startIso = zonedCivilToIso(startDateKey, startMinutes, fromTimeZone)
  const endIso = zonedCivilToIso(endDateKey, endMinutes, fromTimeZone)
  let cursor = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  const slots: { dateKey: string; startMinutes: number }[] = []

  while (cursor < endMs) {
    const parts = isoToZonedParts(new Date(cursor).toISOString(), toTimeZone)
    slots.push({ dateKey: parts.dateKey, startMinutes: parts.startMinutes })
    cursor += SLOT_INTERVAL_MINUTES * 60 * 1000
  }

  return slots
}

export function mapAllDayDatesToTutor(
  startDateKey: string,
  endDateKey: string,
  displayTimeZone: string,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
) {
  const keys: string[] = []
  let current = startDateKey
  const seen = new Set<string>()

  while (current <= endDateKey) {
    const tutorDate = mapCivilBetweenZones(
      current,
      12 * 60,
      displayTimeZone,
      tutorTimeZone,
    ).dateKey
    if (!seen.has(tutorDate)) {
      seen.add(tutorDate)
      keys.push(tutorDate)
    }
    current = addDaysToDateKey(current, 1)
  }

  return keys
}

/** Map weekly template cells between timezones using a reference week. */
export function mapWeeklyCellKeys(
  keys: Iterable<string>,
  fromTimeZone: string,
  toTimeZone: string,
) {
  if (fromTimeZone === toTimeZone) return new Set(keys)

  const weekStart = startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), fromTimeZone))
  const out = new Set<string>()

  for (const key of keys) {
    const { dayOfWeek, startMinutes } = parseCellKey(key)
    const dateKey = addDaysToDateKey(weekStart, dayOfWeek)
    const mapped = mapCivilBetweenZones(dateKey, startMinutes, fromTimeZone, toTimeZone)
    out.add(cellKey(mapped.dayOfWeek, mapped.startMinutes))
  }

  return out
}
