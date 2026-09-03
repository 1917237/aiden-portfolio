export const BOOKING_CONTACT_HINT =
  ' If this keeps happening, contact Aiden for help.'

type SupabaseLikeError = {
  message?: string
  details?: string
  hint?: string
  code?: string
}

/** Pull a message from Error, PostgREST, or other thrown values. */
export function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') {
    return err.trim()
  }

  if (err instanceof Error) {
    return err.message.trim()
  }

  if (typeof err === 'object' && err !== null) {
    const record = err as SupabaseLikeError
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim()
    }
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details.trim()
    }
    if (typeof record.hint === 'string' && record.hint.trim()) {
      return record.hint.trim()
    }
  }

  return ''
}

function isSystemBookingError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    !message ||
    lower === 'booking failed' ||
    lower.includes('is not unique') ||
    lower.includes('could not choose a best candidate') ||
    lower.includes('could not find the function') ||
    lower.includes('pgrst202') ||
    lower.includes('pgrst') ||
    lower.includes('internal server error') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('json') ||
    lower.includes('unexpected token')
  )
}

/** Student-facing booking error copy. */
export function formatBookingRpcError(raw: string): string {
  const message = raw.trim()

  if (!message) {
    return `Something went wrong while booking.${BOOKING_CONTACT_HINT}`
  }

  if (
    message.includes('Slot is already booked') ||
    message.includes('already scheduled during that time') ||
    message.includes('already booked')
  ) {
    return 'Sorry, another student just booked this slot.'
  }

  if (message.includes('That time has already passed')) {
    return 'That time has already passed. Pick a later slot.'
  }

  if (message.includes('That time is not available') || message.includes('Slot not found')) {
    return 'That time is no longer available. Close this panel and pick another green cell.'
  }

  if (message.includes('credit_balance_cents_check') || message.includes('profiles_credit_balance')) {
    return `This student's balance cannot go negative yet. Run supabase/41-allow-negative-credit-balance.sql in the Supabase SQL Editor, then try again.`
  }

  if (message.includes('is not unique') || message.includes('Could not choose')) {
    return `Booking could not run (database setup issue).${BOOKING_CONTACT_HINT}`
  }

  if (message.includes('Could not find the function') && message.includes('student_book_lesson')) {
    return 'Booking is not set up yet. Run supabase/12-student-booking-options.sql in the Supabase SQL Editor, then try again.'
  }

  if (message.includes('Could not find the function') && message.includes('ensure_open_slot')) {
    return 'Run supabase/19-ensure-open-slot.sql in the Supabase SQL Editor, then try again.'
  }

  if (
    message.includes('Could not find the function') &&
    (message.includes('ensure_weekly_series') ||
      message.includes('student_book_series_slot') ||
      message.includes('student_notify_booking_summary') ||
      message.includes('weekly_series'))
  ) {
    return 'Run supabase/20-rolling-weekly-notifications.sql and supabase/21-booking-cancel-notifications.sql in the Supabase SQL Editor, then try again.'
  }

  if (message.includes('Could not find the function') && message.includes('hold_credits')) {
    return `Booking could not reserve credits (database setup issue).${BOOKING_CONTACT_HINT}`
  }

  if (message.includes('Not all weekly times are available')) {
    return 'Run supabase/16-weekly-partial-booking.sql in the SQL Editor so weekly booking can skip unavailable weeks.'
  }

  if (message.includes('Could not find the function') || message.includes('PGRST202')) {
    return `Booking is not fully set up yet.${BOOKING_CONTACT_HINT}`
  }

  if (isSystemBookingError(message)) {
    return `Something went wrong while booking.${BOOKING_CONTACT_HINT}`
  }

  return message
}

export function formatBookingError(err: unknown): string {
  return formatBookingRpcError(extractErrorMessage(err))
}
