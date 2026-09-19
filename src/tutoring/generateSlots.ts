import { TUTOR_SCHEDULE_TIMEZONE } from './config'
import {
  SLOT_INTERVAL_MINUTES,
  WEEKS_AHEAD,
} from './scheduleConfig'
import { occupiedMinutesForDuration } from './bookingDurationConfig'
import { normalizeDateExtras } from './extraAvailabilityUtils'
import type { Blockout, DateAvailability, WeeklyCell } from './scheduleTypes'
import {
  addDaysToDateKey,
  dayOfWeekFromDateKey,
  getDateKeyInTimezone,
  zonedCivilToIso,
} from './timezoneUtils'

/** Open slot placeholder end. shortest bookable lesson block (25 min + break). */
const OPEN_SLOT_END_MINUTES = occupiedMinutesForDuration(25)

function normalizeDateKey(value: string) {
  return String(value).slice(0, 10)
}

function extrasForDate(dateExtras: DateAvailability[], dayKey: string) {
  return new Set(
    normalizeDateExtras(dateExtras)
      .filter((e) => e.availability_date === dayKey)
      .map((e) => e.start_minutes),
  )
}

function isWholeDayBlocked(blockouts: Blockout[], key: string) {
  return blockouts.some(
    (b) => normalizeDateKey(b.blockout_date) === key && b.start_minutes === null,
  )
}

function isIntervalBlocked(
  blockouts: Blockout[],
  dayKey: string,
  startMinutes: number,
  durationMinutes: number,
  dayExtras: Set<number>,
  wholeDay: boolean,
) {
  for (let m = startMinutes; m < startMinutes + durationMinutes; m += SLOT_INTERVAL_MINUTES) {
    if (dayExtras.has(m)) continue
    if (wholeDay) return true
    if (
      blockouts.some(
        (b) => normalizeDateKey(b.blockout_date) === dayKey && b.start_minutes === m,
      )
    ) {
      return true
    }
  }
  return false
}

function availableMinutesForDate(
  dayKey: string,
  dayOfWeek: number,
  weeklyCells: WeeklyCell[],
  dateExtras: DateAvailability[],
) {
  const minutes = new Set(
    weeklyCells.filter((c) => c.day_of_week === dayOfWeek).map((c) => c.start_minutes),
  )

  for (const extra of normalizeDateExtras(dateExtras)) {
    if (extra.availability_date === dayKey) {
      minutes.add(extra.start_minutes)
    }
  }

  return minutes
}

function canFitClass(available: Set<number>, startMinutes: number) {
  for (let m = startMinutes; m < startMinutes + OPEN_SLOT_END_MINUTES; m += SLOT_INTERVAL_MINUTES) {
    if (!available.has(m)) return false
  }
  return true
}

export function generateSlotsFromWeekly(
  weeklyCells: WeeklyCell[],
  blockouts: Blockout[],
  dateExtras: DateAvailability[] = [],
  weeksAhead = WEEKS_AHEAD,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
): { start_time: string; end_time: string }[] {
  const slots: { start_time: string; end_time: string }[] = []
  const now = new Date()
  const nowMs = now.getTime()
  const todayKey = getDateKeyInTimezone(now, tutorTimeZone)
  const dayCount = weeksAhead * 7

  for (let i = 0; i <= dayCount; i += 1) {
    const dayKey = addDaysToDateKey(todayKey, i)
    const wholeDay = isWholeDayBlocked(blockouts, dayKey)
    const dayExtras = extrasForDate(dateExtras, dayKey)
    const dow = dayOfWeekFromDateKey(dayKey)

    let available: Set<number>
    if (wholeDay) {
      if (dayExtras.size === 0) continue
      available = new Set(dayExtras)
    } else {
      available = availableMinutesForDate(dayKey, dow, weeklyCells, dateExtras)
    }

    const starts = [...available].sort((a, b) => a - b)

    for (const startMinutes of starts) {
      if (!canFitClass(available, startMinutes)) continue
      if (
        isIntervalBlocked(
          blockouts,
          dayKey,
          startMinutes,
          OPEN_SLOT_END_MINUTES,
          dayExtras,
          wholeDay,
        )
      ) {
        continue
      }

      const startIso = zonedCivilToIso(dayKey, startMinutes, tutorTimeZone)
      const startMs = new Date(startIso).getTime()
      if (Number.isNaN(startMs) || startMs < nowMs) continue

      const endIso = new Date(
        startMs + OPEN_SLOT_END_MINUTES * 60 * 1000,
      ).toISOString()

      const duplicate = slots.some((s) => s.start_time === startIso)
      if (duplicate) continue

      slots.push({
        start_time: startIso,
        end_time: endIso,
      })
    }
  }

  return slots
}

/** Build available 15-min set for one calendar date (for the day editor UI). */
export function getDateAvailabilityState(
  dateStr: string,
  dayOfWeek: number,
  weeklyCells: WeeklyCell[],
  dateExtras: DateAvailability[],
  blockouts: Blockout[],
) {
  const extras = extrasForDate(dateExtras, dateStr)

  if (isWholeDayBlocked(blockouts, dateStr)) {
    return {
      wholeDayBlocked: true,
      available: new Set(extras),
      extras,
      weekly: new Set<number>(),
      blocked: new Set<number>(),
    }
  }

  const weekly = new Set(
    weeklyCells.filter((c) => c.day_of_week === dayOfWeek).map((c) => c.start_minutes),
  )
  const blocked = new Set(
    blockouts
      .filter(
        (b) => normalizeDateKey(b.blockout_date) === dateStr && b.start_minutes !== null,
      )
      .map((b) => Number(b.start_minutes)),
  )

  const available = new Set<number>()
  for (const m of [...weekly, ...extras]) {
    if (!blocked.has(m) || extras.has(m)) available.add(m)
  }

  return { wholeDayBlocked: false, available, extras, weekly, blocked }
}