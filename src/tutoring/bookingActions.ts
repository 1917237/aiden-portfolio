import { supabase } from '../lib/supabase'
import { isClassTimeBlocked } from './blockoutUtils'
import { occupiedMinutesForDuration } from './bookingDurationConfig'
import { regenerateBookableSlots } from './regenerateSlots'

export async function removeBlockout(blockoutId: string) {
  const { error } = await supabase.from('availability_blockouts').delete().eq('id', blockoutId)
  if (error) throw error
  await regenerateBookableSlots()
}

export async function removeBlockoutsByIds(blockoutIds: string[]) {
  if (blockoutIds.length === 0) return
  const { error } = await supabase.from('availability_blockouts').delete().in('id', blockoutIds)
  if (error) throw error
  await regenerateBookableSlots()
}

export async function removeDateAvailabilitySlots(
  slots: Array<{ availability_date: string; start_minutes: number }>,
) {
  if (slots.length === 0) return

  for (const slot of slots) {
    const { error } = await supabase
      .from('date_availability')
      .delete()
      .eq('availability_date', slot.availability_date)
      .eq('start_minutes', slot.start_minutes)
    if (error) throw error
  }

  await regenerateBookableSlots()
}

/**
 * Admin cancel flow: optional note for the student's notification.
 * Use CancelClassDialog in the UI to collect the note.
 */
export async function cancelBooking(bookingId: string, comment?: string | null) {
  const { error } = await supabase.rpc('cancel_booking', {
    p_booking_id: bookingId,
    p_comment: comment ?? null,
  })
  if (error) {
    if (isMissingRpc(error.message)) {
      throw new Error(
        'Run supabase/32-safe-slot-delete-cancel-comment.sql in the Supabase SQL Editor, then try again.',
      )
    }
    throw error
  }
  // Refresh slots in the background. awaiting this blocked the schedule modal on cancel.
  void regenerateBookableSlots().catch(() => {})
}

function isMissingRpc(message: string) {
  return (
    message.includes('Could not find the function') ||
    message.includes('does not exist') ||
    message.includes('PGRST202')
  )
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && startB < endA
}

async function rescheduleViaSlotUpdate(
  bookingId: string,
  slotId: string,
  startIso: string,
  endIso: string,
) {
  const { data: otherBookings, error: loadError } = await supabase
    .from('bookings')
    .select('id, availability_slots(start_time, end_time)')
    .eq('status', 'booked')
    .neq('id', bookingId)

  if (loadError) throw loadError

  for (const row of otherBookings ?? []) {
    const slotRaw = row.availability_slots
    const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as
      | { start_time: string; end_time: string }
      | null
      | undefined
    if (!slot?.start_time || !slot.end_time) continue
    if (rangesOverlap(startIso, endIso, slot.start_time, slot.end_time)) {
      throw new Error('Another class is already scheduled at this time')
    }
  }

  const { error: updateError } = await supabase
    .from('availability_slots')
    .update({ start_time: startIso, end_time: endIso })
    .eq('id', slotId)

  if (updateError) throw updateError
}

export async function rescheduleBookingToTime(
  bookingId: string,
  dateKey: string,
  startMinutes: number,
  startIso: string,
  _endIso: string,
  blockouts: { blockout_date: string; start_minutes: number | null }[],
  durationMinutes?: number,
) {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('slot_id, status, duration_minutes')
    .eq('id', bookingId)
    .single()

  if (bookingError || !booking) {
    throw new Error('Booking not found')
  }

  if (booking.status !== 'booked') {
    throw new Error('Only active bookings can be rescheduled')
  }

  const resolvedDuration = durationMinutes ?? booking.duration_minutes ?? 50
  const occupyMinutes = occupiedMinutesForDuration(resolvedDuration)
  const endIso = new Date(
    new Date(startIso).getTime() + occupyMinutes * 60_000,
  ).toISOString()

  if (isClassTimeBlocked(dateKey, startMinutes, blockouts, occupyMinutes)) {
    throw new Error('That time is blocked. Pick another date or time.')
  }

  const { error: rpcError } = await supabase.rpc('admin_reschedule_booking_to_time', {
    p_booking_id: bookingId,
    p_date: dateKey,
    p_start_minutes: startMinutes,
    p_start_time: startIso,
    p_end_time: endIso,
    p_duration_minutes: resolvedDuration,
  })

  if (!rpcError) {
    await regenerateBookableSlots()
    return
  }

  if (!isMissingRpc(rpcError.message)) {
    throw rpcError
  }

  await rescheduleViaSlotUpdate(bookingId, booking.slot_id, startIso, endIso)
  await regenerateBookableSlots()
}
