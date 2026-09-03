import { TUTOR_SCHEDULE_TIMEZONE } from './config'
import {
  type BookedRange,
  type ScheduleContext,
  isSlotTakenByBooking,
} from './bookingAvailabilityUtils'
import { occupiedMinutesForDuration } from './bookingDurationConfig'
import { generateSlotsFromWeekly } from './generateSlots'
import { SLOT_INTERVAL_MINUTES, WEEKS_AHEAD } from './scheduleConfig'
import type { AvailabilitySlot } from './types'
import {
  getDateKeyInTimezone,
  isoToZonedParts,
  type ZonedWeekDay,
} from './timezoneUtils'
import { supabase } from '../lib/supabase'

export type ScheduleGridCell = {
  startIso: string
  dateKey: string
  startMinutes: number
}

function cellMapKey(dateKey: string, startMinutes: number) {
  return `${dateKey}-${startMinutes}`
}

export function virtualSlot(startIso: string, endIso?: string): AvailabilitySlot {
  const startMs = new Date(startIso).getTime()
  const end =
    endIso ??
    new Date(startMs + occupiedMinutesForDuration(50) * 60 * 1000).toISOString()
  return {
    id: `virtual:${startIso}`,
    start_time: startIso,
    end_time: end,
    is_booked: false,
    created_at: '',
  }
}

export function isVirtualSlot(slot: AvailabilitySlot) {
  return slot.id.startsWith('virtual:')
}

/**
 * Open lesson starts from weekly − blockouts + extras − bookings.
 * Schedule is evaluated in the tutor timezone (same as slot regeneration).
 * When dateKeys is set, only slots whose display-timezone civil date is listed are kept.
 */
export function collectOpenStartIsos(
  dateKeys: string[] | null,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  displayTimeZone: string,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
  weeksAhead = WEEKS_AHEAD,
): string[] {
  const generated = generateSlotsFromWeekly(
    schedule.weeklyCells,
    schedule.blockouts,
    schedule.dateExtras,
    weeksAhead,
    tutorTimeZone,
  )

  const filterSet = dateKeys ? new Set(dateKeys) : null
  const starts: string[] = []

  for (const slot of generated) {
    if (filterSet) {
      const displayDateKey = getDateKeyInTimezone(slot.start_time, displayTimeZone)
      if (!filterSet.has(displayDateKey)) continue
    }
    if (isSlotTakenByBooking(slot.start_time, null, bookedRanges)) continue
    starts.push(slot.start_time)
  }

  return starts
}

/** Schedule-valid starts hidden because another lesson occupies that time. */
export function collectTakenStartIsos(
  dateKeys: string[] | null,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  displayTimeZone: string,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
  weeksAhead = WEEKS_AHEAD,
): string[] {
  const generated = generateSlotsFromWeekly(
    schedule.weeklyCells,
    schedule.blockouts,
    schedule.dateExtras,
    weeksAhead,
    tutorTimeZone,
  )

  const filterSet = dateKeys ? new Set(dateKeys) : null
  const taken: string[] = []

  for (const slot of generated) {
    if (filterSet) {
      const displayDateKey = getDateKeyInTimezone(slot.start_time, displayTimeZone)
      if (!filterSet.has(displayDateKey)) continue
    }
    if (!isSlotTakenByBooking(slot.start_time, null, bookedRanges)) continue
    taken.push(slot.start_time)
  }

  return taken
}

export function buildScheduleGridCells(
  weekDays: ZonedWeekDay[],
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  displayTimeZone: string,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
): {
  cellsByKey: Map<string, ScheduleGridCell>
  startHour: number
  endHour: number
} {
  const dateKeys = weekDays.map((day) => day.dateKey)
  const starts = collectOpenStartIsos(
    dateKeys,
    schedule,
    bookedRanges,
    displayTimeZone,
    tutorTimeZone,
  )

  const cellsByKey = new Map<string, ScheduleGridCell>()
  let minMin = Number.POSITIVE_INFINITY
  let maxMin = Number.NEGATIVE_INFINITY

  for (const startIso of starts) {
    const { dateKey, startMinutes } = isoToZonedParts(startIso, displayTimeZone)
    const snapped = Math.round(startMinutes / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES
    cellsByKey.set(cellMapKey(dateKey, snapped), {
      startIso,
      dateKey,
      startMinutes: snapped,
    })
    minMin = Math.min(minMin, snapped)
    maxMin = Math.max(maxMin, snapped + SLOT_INTERVAL_MINUTES)
  }

  const startHour = Number.isFinite(minMin) ? Math.max(0, Math.floor(minMin / 60)) : 8
  const endHour = Number.isFinite(maxMin)
    ? Math.min(24, Math.max(startHour + 1, Math.ceil(maxMin / 60)))
    : 24

  return { cellsByKey, startHour, endHour }
}

/** Horizon of open starts as AvailabilitySlot rows (real IDs when present). */
export function buildScheduleOpenSlots(
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  displayTimeZone: string,
  realSlotsByStart: Map<number, AvailabilitySlot> = new Map(),
  weeksAhead = WEEKS_AHEAD,
  tutorTimeZone: string = TUTOR_SCHEDULE_TIMEZONE,
): AvailabilitySlot[] {
  const starts = collectOpenStartIsos(
    null,
    schedule,
    bookedRanges,
    displayTimeZone,
    tutorTimeZone,
    weeksAhead,
  )

  const seen = new Set<number>()
  const slots: AvailabilitySlot[] = []

  for (const startIso of starts) {
    const key = new Date(startIso).getTime()
    if (Number.isNaN(key) || seen.has(key)) continue
    seen.add(key)
    slots.push(realSlotsByStart.get(key) ?? virtualSlot(startIso))
  }

  return slots
}

export async function ensureOpenSlot(
  startIso: string,
  endIso?: string,
): Promise<AvailabilitySlot> {
  const startMs = new Date(startIso).getTime()
  const end =
    endIso ??
    new Date(startMs + occupiedMinutesForDuration(50) * 60 * 1000).toISOString()

  const { data, error } = await supabase.rpc('ensure_open_slot', {
    p_start_time: startIso,
    p_end_time: end,
  })

  if (error) {
    const message = error.message || 'Could not create that time slot'
    if (message.includes('Could not find the function') || message.includes('ensure_open_slot')) {
      throw new Error(
        'Run supabase/19-ensure-open-slot.sql in the Supabase SQL Editor, then try again.',
      )
    }
    throw new Error(message)
  }
  if (!data) throw new Error('Could not create that time slot')

  const row = (Array.isArray(data) ? data[0] : data) as AvailabilitySlot
  return row
}

/** Create a DB slot sized for the chosen lesson length (virtual grid cells). */
export async function ensureOpenSlotForDuration(
  startIso: string,
  durationMinutes: number,
): Promise<AvailabilitySlot> {
  const occupyEndIso = new Date(
    new Date(startIso).getTime() + occupiedMinutesForDuration(durationMinutes) * 60_000,
  ).toISOString()
  return ensureOpenSlot(startIso, occupyEndIso)
}
