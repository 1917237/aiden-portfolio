import {
  BOOKING_DURATION_OPTIONS,
  DEFAULT_BOOKING_DURATION_MINUTES,
  WEEKLY_LESSON_COUNT,
  formatDurationLabel,
  occupiedMinutesForDuration,
  type BookingDurationMinutes,
} from './bookingDurationConfig'
import { TUTOR_SCHEDULE_TIMEZONE } from './config'
import { formatTimeLabel, SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import { getDateAvailabilityState } from './generateSlots'
import { dayOfWeekFromDateKey, isoToZonedParts, addDaysToDateKey, zonedCivilToIso } from './timezoneUtils'
import type { AvailabilitySlot } from './types'
import type { Blockout, DateAvailability, WeeklyCell } from './scheduleTypes'
import { supabase } from '../lib/supabase'

export type ScheduleContext = {
  weeklyCells: WeeklyCell[]
  blockouts: Blockout[]
  dateExtras: DateAvailability[]
}

export type BookedRange = {
  start_time: string
  end_time: string
  /** Lesson length; occupied calendar block is derived from this. */
  duration_minutes?: number | null
}

export function timeKey(iso: string) {
  return new Date(iso).getTime()
}

export function bookedOccupiedEndMs(range: BookedRange) {
  const startMs = timeKey(range.start_time)
  if (Number.isNaN(startMs)) return NaN
  if (range.duration_minutes && range.duration_minutes > 0) {
    return startMs + occupiedMinutesForDuration(range.duration_minutes) * 60 * 1000
  }
  const endMs = timeKey(range.end_time)
  return Number.isNaN(endMs) ? startMs + 60 * 60 * 1000 : endMs
}

export function unwrapSlotRelation<T extends { start_time?: string; end_time?: string }>(
  raw: T | T[] | null | undefined,
): T | null {
  if (!raw) return null
  return (Array.isArray(raw) ? raw[0] : raw) ?? null
}

/** All booked occupy windows (shared across students. no names). */
export async function loadOccupiedBookingRanges(): Promise<BookedRange[]> {
  const { data, error } = await supabase.rpc('list_occupied_booking_ranges')
  if (error) {
    // Fallback for DBs that haven't run migration 23 yet (own bookings only).
    const fallback = await supabase
      .from('bookings')
      .select('duration_minutes, availability_slots(start_time, end_time)')
      .eq('status', 'booked')

    if (fallback.error) throw error

    const ranges: BookedRange[] = []
    for (const row of fallback.data ?? []) {
      const slot = unwrapSlotRelation(
        row.availability_slots as
          | { start_time?: string; end_time?: string }
          | { start_time?: string; end_time?: string }[]
          | null,
      )
      if (!slot?.start_time || !slot.end_time) continue
      ranges.push({
        start_time: slot.start_time,
        end_time: slot.end_time,
        duration_minutes: (row.duration_minutes as number | null) ?? null,
      })
    }
    return ranges
  }

  return ((data ?? []) as Array<{
    start_time: string
    end_time: string
    duration_minutes: number | null
  }>).map((row) => ({
    start_time: row.start_time,
    end_time: row.end_time,
    duration_minutes: row.duration_minutes,
  }))
}

/**
 * Hide an open start time if it falls inside a booking's occupied window
 * [start, start + occupiedMinutes). Next student can book exactly at the end.
 */
export function isSlotTakenByBooking(
  slotStartIso: string,
  _slotEndIso: string | null | undefined,
  bookedRanges: BookedRange[],
) {
  const startMs = timeKey(slotStartIso)
  if (Number.isNaN(startMs)) return false

  for (const range of bookedRanges) {
    const bookedStart = timeKey(range.start_time)
    const occupiedEnd = bookedOccupiedEndMs(range)
    if (Number.isNaN(bookedStart) || Number.isNaN(occupiedEnd)) continue
    if (startMs >= bookedStart && startMs < occupiedEnd) return true
  }
  return false
}

export type WeeklyWeekStatus = {
  weekIndex: number
  startIso: string
  label: string
  available: boolean
  reason?: string
  slot?: AvailabilitySlot
}

function canFitDuration(available: Set<number>, startMinutes: number, durationMinutes: number) {
  for (let m = startMinutes; m < startMinutes + durationMinutes; m += SLOT_INTERVAL_MINUTES) {
    if (!available.has(m)) return false
  }
  return true
}

function availableMinutesFromStart(available: Set<number>, startMinutes: number) {
  let minutes = 0
  for (let m = startMinutes; available.has(m); m += SLOT_INTERVAL_MINUTES) {
    minutes += SLOT_INTERVAL_MINUTES
  }
  return minutes
}

/** Absolute-time conflict check (timezone-safe). */
function conflictsWithBooked(
  slotStartIso: string,
  durationMinutes: number,
  bookedRanges: BookedRange[],
) {
  const startMs = timeKey(slotStartIso)
  if (Number.isNaN(startMs)) return true
  const endMs = startMs + occupiedMinutesForDuration(durationMinutes) * 60 * 1000

  for (const range of bookedRanges) {
    const bookedStart = timeKey(range.start_time)
    const occupiedEnd = bookedOccupiedEndMs(range)
    if (Number.isNaN(bookedStart) || Number.isNaN(occupiedEnd)) continue
    if (startMs < occupiedEnd && endMs > bookedStart) return true
  }
  return false
}

/**
 * Minutes free from this start until the next booking or a gap in open 15-min slots.
 * Absolute timestamps. same answer in every student timezone.
 */
export function minutesOpenFromStart(
  slotStartIso: string,
  openSlots: AvailabilitySlot[],
  bookedRanges: BookedRange[],
) {
  const startMs = timeKey(slotStartIso)
  if (Number.isNaN(startMs)) return 0

  const openKeys = new Set(
    openSlots.map((slot) => timeKey(slot.start_time)).filter((value) => !Number.isNaN(value)),
  )
  openKeys.add(startMs)

  let limitMs = startMs + 12 * 60 * 60 * 1000
  for (const range of bookedRanges) {
    const bookedStart = timeKey(range.start_time)
    const occupiedEnd = bookedOccupiedEndMs(range)
    if (Number.isNaN(bookedStart) || Number.isNaN(occupiedEnd)) continue
    if (occupiedEnd <= startMs) continue
    if (bookedStart <= startMs && occupiedEnd > startMs) return 0
    if (bookedStart > startMs) limitMs = Math.min(limitMs, bookedStart)
  }

  let minutes = 0
  for (let t = startMs; t < limitMs; t += SLOT_INTERVAL_MINUTES * 60 * 1000) {
    if (!openKeys.has(t)) break
    minutes += SLOT_INTERVAL_MINUTES
  }
  return minutes
}

/**
 * Add whole weeks keeping the same wall-clock time in a timezone (DST-safe).
 * e.g. 3:00 PM PT stays 3:00 PM PT across a spring/fall change.
 */
export function addWeeksToIso(
  iso: string,
  weeks: number,
  timeZone: string = TUTOR_SCHEDULE_TIMEZONE,
) {
  if (weeks === 0) return new Date(iso).toISOString()
  const parts = isoToZonedParts(iso, timeZone)
  const nextDateKey = addDaysToDateKey(parts.dateKey, weeks * 7)
  return zonedCivilToIso(nextDateKey, parts.startMinutes, timeZone)
}

function formatWeekLabel(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export type DurationOptionState = {
  minutes: BookingDurationMinutes
  ok: boolean
  reason?: string
}

export function getDurationOptionStates(
  slotStartIso: string,
  openSlots: AvailabilitySlot[],
  bookedRanges: BookedRange[],
): DurationOptionState[] {
  const openMinutes = minutesOpenFromStart(slotStartIso, openSlots, bookedRanges)

  return BOOKING_DURATION_OPTIONS.map((minutes) => {
    const need = occupiedMinutesForDuration(minutes)
    if (openMinutes <= 0) {
      return {
        minutes,
        ok: false,
        reason: 'This time is no longer available.',
      }
    }
    if (conflictsWithBooked(slotStartIso, minutes, bookedRanges)) {
      return {
        minutes,
        ok: false,
        reason: 'Another lesson overlaps this length.',
      }
    }
    if (need > openMinutes) {
      return {
        minutes,
        ok: false,
        reason: `Only ${openMinutes} minutes free until the next class. not enough for a ${formatDurationLabel(minutes)} lesson.`,
      }
    }
    return { minutes, ok: true }
  })
}

export function validateLessonDuration(
  slotStartIso: string,
  durationMinutes: number,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  _timeZone?: string,
  openSlots: AvailabilitySlot[] = [],
): { ok: true } | { ok: false; reason: string } {
  // Schedule template is always interpreted in the tutor timezone.
  const { dateKey, startMinutes, hour12, minute, period } = isoToZonedParts(
    slotStartIso,
    TUTOR_SCHEDULE_TIMEZONE,
  )
  const dayOfWeek = dayOfWeekFromDateKey(dateKey)

  if (conflictsWithBooked(slotStartIso, durationMinutes, bookedRanges)) {
    return { ok: false, reason: 'Another lesson is already scheduled during that time.' }
  }

  const occupyMinutes = occupiedMinutesForDuration(durationMinutes)

  if (openSlots.length > 0) {
    const openMinutes = minutesOpenFromStart(slotStartIso, openSlots, bookedRanges)
    if (occupyMinutes > openMinutes) {
      return {
        ok: false,
        reason: `Only ${openMinutes} minutes free until the next class. not enough for a ${durationMinutes}-minute lesson.`,
      }
    }
    return { ok: true }
  }

  const { available } = getDateAvailabilityState(
    dateKey,
    dayOfWeek,
    schedule.weeklyCells,
    schedule.dateExtras,
    schedule.blockouts,
  )

  if (!available.has(startMinutes)) {
    return { ok: false, reason: 'That start time is not available.' }
  }

  if (!canFitDuration(available, startMinutes, occupyMinutes)) {
    const openMinutes = availableMinutesFromStart(available, startMinutes)
    const endMinutes = startMinutes + occupyMinutes
    const endHour = Math.floor(endMinutes / 60)
    const endMin = endMinutes % 60
    const endPeriod = endHour >= 12 ? 'PM' : 'AM'
    const endHour12 = endHour % 12 === 0 ? 12 : endHour % 12
    const endLabel =
      endMin === 0
        ? `${endHour12} ${endPeriod}`
        : `${endHour12}:${String(endMin).padStart(2, '0')} ${endPeriod}`

    const availEndMinutes = startMinutes + openMinutes
    const availLabel = formatTimeLabel(availEndMinutes)

    const startLabel =
      minute === 0
        ? `${hour12} ${period}`
        : `${hour12}:${String(minute).padStart(2, '0')} ${period}`

    return {
      ok: false,
      reason: `A ${durationMinutes}-minute lesson starting at ${startLabel} needs availability until ${endLabel}, but availability ends at ${availLabel}. Try a shorter duration.`,
    }
  }

  return { ok: true }
}

export function analyzeWeeklyLesson(
  baseSlot: AvailabilitySlot,
  durationMinutes: BookingDurationMinutes,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  openSlots: AvailabilitySlot[],
  occupiedTimes: Set<string>,
  timeZone?: string,
): {
  weeks: WeeklyWeekStatus[]
  availableSlots: AvailabilitySlot[]
  unavailableWeeks: WeeklyWeekStatus[]
} {
  const slotsByStart = new Map(openSlots.map((slot) => [timeKey(slot.start_time), slot]))
  const occupiedKeys = new Set(
    [...occupiedTimes].map((iso) => timeKey(iso)).filter((value) => !Number.isNaN(value)),
  )
  const weeks: WeeklyWeekStatus[] = []
  const zone = timeZone ?? TUTOR_SCHEDULE_TIMEZONE

  for (let week = 0; week < WEEKLY_LESSON_COUNT; week += 1) {
    const startIso = addWeeksToIso(baseSlot.start_time, week, zone)
    const startMs = timeKey(startIso)
    const label = formatWeekLabel(startIso, zone)

    if (occupiedKeys.has(startMs)) {
      weeks.push({
        weekIndex: week,
        startIso,
        label,
        available: false,
        reason: 'Already booked',
      })
      continue
    }

    const slot = week === 0 ? baseSlot : slotsByStart.get(startMs)
    if (!slot) {
      weeks.push({
        weekIndex: week,
        startIso,
        label,
        available: false,
        reason: 'Not open',
      })
      continue
    }

    const durationCheck = validateLessonDuration(
      slot.start_time,
      durationMinutes,
      schedule,
      bookedRanges,
      zone,
      openSlots,
    )
    if (!durationCheck.ok) {
      weeks.push({
        weekIndex: week,
        startIso,
        label,
        available: false,
        reason: durationCheck.reason,
        slot,
      })
      continue
    }

    weeks.push({
      weekIndex: week,
      startIso,
      label,
      available: true,
      slot,
    })
  }

  const availableSlots = weeks
    .filter((week) => week.available && week.slot)
    .map((week) => week.slot as AvailabilitySlot)
  const unavailableWeeks = weeks.filter((week) => !week.available)

  return { weeks, availableSlots, unavailableWeeks }
}

export function findWeeklySlots(
  baseSlot: AvailabilitySlot,
  openSlots: AvailabilitySlot[],
  occupiedTimes: Set<string>,
): AvailabilitySlot[] {
  const slotsByStart = new Map(openSlots.map((slot) => [timeKey(slot.start_time), slot]))
  const occupiedKeys = new Set(
    [...occupiedTimes].map((iso) => timeKey(iso)).filter((value) => !Number.isNaN(value)),
  )
  const found: AvailabilitySlot[] = []

  for (let week = 0; week < WEEKLY_LESSON_COUNT; week += 1) {
    const startIso = addWeeksToIso(baseSlot.start_time, week, TUTOR_SCHEDULE_TIMEZONE)
    const startMs = timeKey(startIso)
    if (occupiedKeys.has(startMs)) break
    const slot = week === 0 ? baseSlot : slotsByStart.get(startMs)
    if (!slot) break
    found.push(slot)
  }
  return found
}

export function validateWeeklyLesson(
  baseSlot: AvailabilitySlot,
  durationMinutes: BookingDurationMinutes,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  openSlots: AvailabilitySlot[],
  occupiedTimes: Set<string>,
  timeZone?: string,
):
  | {
      ok: true
      slots: AvailabilitySlot[]
      weeks: WeeklyWeekStatus[]
      unavailableWeeks: WeeklyWeekStatus[]
      partial: boolean
    }
  | {
      ok: false
      reason: string
      weeks: WeeklyWeekStatus[]
      unavailableWeeks: WeeklyWeekStatus[]
    } {
  const analysis = analyzeWeeklyLesson(
    baseSlot,
    durationMinutes,
    schedule,
    bookedRanges,
    openSlots,
    occupiedTimes,
    timeZone,
  )

  if (analysis.availableSlots.length === 0) {
    return {
      ok: false,
      reason: `None of the next ${WEEKLY_LESSON_COUNT} weeks are available at this time.`,
      weeks: analysis.weeks,
      unavailableWeeks: analysis.unavailableWeeks,
    }
  }

  const firstWeek = analysis.weeks[0]
  if (!firstWeek?.available) {
    return {
      ok: false,
      reason: firstWeek?.reason ?? 'This week is not available.',
      weeks: analysis.weeks,
      unavailableWeeks: analysis.unavailableWeeks,
    }
  }

  return {
    ok: true,
    slots: analysis.availableSlots,
    weeks: analysis.weeks,
    unavailableWeeks: analysis.unavailableWeeks,
    partial: analysis.unavailableWeeks.length > 0,
  }
}

/** Open DB slots that aren't inside another booking's occupy window. */
export function isSlotBookable(
  slotStartIso: string,
  _schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  _minDurationMinutes: number = 25,
): boolean {
  return !isSlotTakenByBooking(slotStartIso, null, bookedRanges)
}

export function isDurationOption(value: number): value is BookingDurationMinutes {
  return value === 25 || value === 50 || value === 80 || value === 110
}

export function defaultDurationIfInvalid(value: number) {
  return isDurationOption(value) ? value : DEFAULT_BOOKING_DURATION_MINUTES
}
