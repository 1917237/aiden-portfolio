import { supabase } from '../lib/supabase'
import {
  type BookedRange,
  type ScheduleContext,
  loadOccupiedBookingRanges,
  timeKey,
  validateLessonDuration,
} from './bookingAvailabilityUtils'
import { WEEKS_AHEAD } from './scheduleConfig'
import { buildScheduleOpenSlots, collectTakenStartIsos } from './studentScheduleAvailability'
import type { AvailabilitySlot } from './types'

export type StudentOpenSlotsResult = {
  schedule: ScheduleContext
  bookedRanges: BookedRange[]
  allOpenSlots: AvailabilitySlot[]
  takenStartIsos: string[]
}

export async function loadStudentOpenSlots(
  timeZone: string,
  options?: { excludeBookingStartIso?: string },
): Promise<StudentOpenSlotsResult> {
  const now = new Date().toISOString()
  const horizonEnd = new Date()
  horizonEnd.setDate(horizonEnd.getDate() + WEEKS_AHEAD * 7)

  const [allSlotsResult, occupiedRanges, weeklyResult, blockoutResult, dateExtraResult] =
    await Promise.all([
      supabase
        .from('availability_slots')
        .select('*')
        .eq('is_booked', false)
        .gte('start_time', now)
        .lte('start_time', horizonEnd.toISOString())
        .order('start_time', { ascending: true }),
      loadOccupiedBookingRanges(),
      supabase.from('weekly_availability').select('day_of_week, start_minutes'),
      supabase.from('availability_blockouts').select('blockout_date, start_minutes'),
      supabase.from('date_availability').select('availability_date, start_minutes'),
    ])

  if (weeklyResult.error) throw weeklyResult.error
  if (blockoutResult.error) throw blockoutResult.error
  if (dateExtraResult.error) throw dateExtraResult.error

  const schedule: ScheduleContext = {
    weeklyCells: weeklyResult.data ?? [],
    blockouts: blockoutResult.data ?? [],
    dateExtras: dateExtraResult.data ?? [],
  }

  let bookedRanges = occupiedRanges
  if (options?.excludeBookingStartIso) {
    const excludeMs = timeKey(options.excludeBookingStartIso)
    bookedRanges = bookedRanges.filter((range) => timeKey(range.start_time) !== excludeMs)
  }

  const realSlotsByStart = new Map<number, AvailabilitySlot>()
  for (const slot of (allSlotsResult.data ?? []) as AvailabilitySlot[]) {
    const key = timeKey(slot.start_time)
    if (Number.isNaN(key) || realSlotsByStart.has(key)) continue
    realSlotsByStart.set(key, slot)
  }

  const allOpenSlots = buildScheduleOpenSlots(
    schedule,
    bookedRanges,
    timeZone,
    realSlotsByStart,
  )

  const takenStartIsos = collectTakenStartIsos(null, schedule, bookedRanges, timeZone)

  return { schedule, bookedRanges, allOpenSlots, takenStartIsos }
}

/** Keep only starts where the full lesson length fits (same rules as booking). */
export function filterSlotsForLessonDuration(
  slots: AvailabilitySlot[],
  durationMinutes: number,
  schedule: ScheduleContext,
  bookedRanges: BookedRange[],
  timeZone: string,
  allOpenSlots: AvailabilitySlot[],
): AvailabilitySlot[] {
  return slots.filter((slot) =>
    validateLessonDuration(
      slot.start_time,
      durationMinutes,
      schedule,
      bookedRanges,
      timeZone,
      allOpenSlots,
    ).ok,
  )
}
