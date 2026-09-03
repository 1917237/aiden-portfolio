import { generateSlotsFromWeekly } from './generateSlots'
import type { Blockout, DateAvailability, WeeklyCell } from './scheduleTypes'
import { supabase } from '../lib/supabase'
import { isMissingTableError } from './supabaseErrors'
import {
  bookedOccupiedEndMs,
  timeKey,
  type BookedRange,
  unwrapSlotRelation,
} from './bookingAvailabilityUtils'

export async function regenerateBookableSlots() {
  const [weeklyResult, blockoutResult, dateExtraResult, bookingsResult] = await Promise.all([
    supabase.from('weekly_availability').select('day_of_week, start_minutes'),
    supabase.from('availability_blockouts').select('blockout_date, start_minutes'),
    supabase.from('date_availability').select('availability_date, start_minutes'),
    supabase
      .from('bookings')
      .select('duration_minutes, availability_slots(start_time, end_time)')
      .eq('status', 'booked'),
  ])

  const weekly = weeklyResult.data
  const blockoutRows = blockoutResult.data
  const dateExtraRows =
    dateExtraResult.error &&
    isMissingTableError(dateExtraResult.error.message, 'date_availability')
      ? []
      : dateExtraResult.data

  await supabase
    .from('availability_slots')
    .delete()
    .eq('is_booked', false)
    .gte('start_time', new Date().toISOString())

  const generated = generateSlotsFromWeekly(
    (weekly ?? []) as WeeklyCell[],
    (blockoutRows ?? []) as Blockout[],
    (dateExtraRows ?? []) as DateAvailability[],
  )

  const nowIso = new Date().toISOString()
  const { data: existingRows } = await supabase
    .from('availability_slots')
    .select('start_time')
    .gte('start_time', nowIso)

  const existingTimes = new Set(
    (existingRows ?? [])
      .map((row) => timeKey(row.start_time as string))
      .filter((value) => !Number.isNaN(value)),
  )

  const bookedRanges: BookedRange[] = []
  for (const row of bookingsResult.data ?? []) {
    const slot = unwrapSlotRelation(
      row.availability_slots as
        | { start_time?: string; end_time?: string }
        | { start_time?: string; end_time?: string }[]
        | null,
    )
    if (!slot?.start_time || !slot.end_time) continue
    bookedRanges.push({
      start_time: slot.start_time,
      end_time: slot.end_time,
      duration_minutes: (row.duration_minutes as number | null) ?? null,
    })
  }

  const toInsert = generated.filter((slot) => {
    const startMs = timeKey(slot.start_time)
    if (Number.isNaN(startMs) || existingTimes.has(startMs)) return false
    for (const range of bookedRanges) {
      const bookedStart = timeKey(range.start_time)
      const occupiedEnd = bookedOccupiedEndMs(range)
      if (Number.isNaN(bookedStart) || Number.isNaN(occupiedEnd)) continue
      if (startMs >= bookedStart && startMs < occupiedEnd) return false
    }
    return true
  })

  if (toInsert.length > 0) {
    await supabase.from('availability_slots').insert(toInsert)
  }

  return toInsert.length
}
