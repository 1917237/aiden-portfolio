import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { lessonCostCents } from '../../tutoring/bookingDurationConfig'
import {
  CONFIRM_CLASS_BUFFER_MINUTES,
  isBookingReadyToConfirm,
} from '../../tutoring/confirmClassUtils'
import { cancelBooking } from '../../tutoring/bookingActions'
import { formatCredits, formatSignedCredits, formatSlotRange } from '../../tutoring/format'
import type { BookingWithDetails } from '../../tutoring/types'
import { supabase } from '../../lib/supabase'
import { CancelClassDialog } from './CancelClassDialog'
import { ConfirmClassButton } from './ConfirmClassButton'
import { CreditBalance } from './CreditBalance'

export type ConfirmState = 'idle' | 'loading' | 'success' | 'error'

type Props = {
  booking: BookingWithDetails
  timeZone: string
  balanceCents: number
  confirmState?: ConfirmState
  cancelState?: ConfirmState
  rowError?: string | null
  shake?: boolean
  showCalendarLink?: boolean
  hideStudentName?: boolean
  onConfirm: () => void
  onCancel: (comment: string | null) => void
}

function formatConfirmError(message: string) {
  if (
    message.includes('Could not find the function') ||
    message.includes('Could not choose the best candidate')
  ) {
    return 'Run supabase/09-fix-complete-booking.sql in the SQL Editor first.'
  }
  return message
}

export { formatConfirmError }

export function AdminBookingRow({
  booking,
  timeZone,
  balanceCents,
  confirmState = 'idle',
  cancelState = 'idle',
  rowError = null,
  shake = false,
  showCalendarLink = false,
  hideStudentName = false,
  onConfirm,
  onCancel,
}: Props) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const rate = booking.profiles.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS
  const duration = booking.duration_minutes ?? 50
  const charge = lessonCostCents(rate, duration)
  const held = booking.charged_cents ?? 0
  const shortfall = held > 0 ? balanceCents < 0 : balanceCents < charge
  const isBusy = confirmState === 'loading' || cancelState === 'loading'
  const ready = isBookingReadyToConfirm(booking.availability_slots.end_time)

  return (
    <li
      className={`border px-4 py-3 ${rowError ? 'border-red-300 bg-red-50/40' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {hideStudentName ? null : (
            <p className="font-semibold">{booking.profiles.full_name}</p>
          )}
          <p className={`text-sm text-ink-muted${hideStudentName ? ' font-semibold text-ink' : ''}`}>
            {formatSlotRange(
              booking.availability_slots.start_time,
              booking.availability_slots.end_time,
              timeZone,
            )}
            {' · '}
            {formatCredits(charge)}
            {booking.pay_later ? ' · pay later' : null}
          </p>
          <p className="mt-1 text-sm">
            Balance: <CreditBalance cents={balanceCents} />
            {held > 0 ? (
              <span className="text-ink-muted"> ({formatCredits(held)} reserved at booking)</span>
            ) : shortfall ? (
              <span className="text-ink-muted">
                {' '}
                ({formatSignedCredits(charge - balanceCents)} short for this class)
              </span>
            ) : null}
          </p>
          {!ready ? (
            <p className="mt-1 text-xs text-ink-muted">
              Confirm available {CONFIRM_CLASS_BUFFER_MINUTES} min before class ends.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showCalendarLink ? (
            <Link
              to="/tutoring/calendar"
              className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
            >
              Calendar
            </Link>
          ) : null}
          <button
            type="button"
            disabled={isBusy || cancelState === 'success'}
            onClick={() => setCancelDialogOpen(true)}
            className={`border px-3 py-1.5 text-sm font-semibold transition-colors ${
              cancelState === 'success'
                ? 'border-line bg-bg-elevated text-ink-muted'
                : 'border-line hover:bg-bg-elevated'
            } ${shake ? 'confirm-btn-shake' : ''} disabled:opacity-60`}
          >
            {cancelState === 'loading'
              ? 'Cancelling…'
              : cancelState === 'success'
                ? 'Cancelled'
                : 'Cancel'}
          </button>
          {ready ? (
            <ConfirmClassButton
              state={confirmState}
              shake={shake}
              disabled={isBusy || cancelState === 'success'}
              onClick={onConfirm}
            />
          ) : null}
        </div>
      </div>
      {rowError ? <p className="mt-2 text-sm font-medium text-red-700">{rowError}</p> : null}

      <CancelClassDialog
        open={cancelDialogOpen}
        variant="admin"
        busy={cancelState === 'loading'}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={({ comment }) => {
          setCancelDialogOpen(false)
          onCancel(comment)
        }}
      />
    </li>
  )
}

export async function completeBookingForAdmin(
  booking: BookingWithDetails,
  balanceCents: number,
): Promise<{ message: string }> {
  const rate = booking.profiles.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS
  const duration = booking.duration_minutes ?? 50
  const charge = lessonCostCents(rate, duration)

  const { error: rpcError } = await supabase.rpc('complete_booking', {
    p_booking_id: booking.id,
  })

  if (rpcError) {
    throw new Error(formatConfirmError(rpcError.message))
  }

  if (booking.charged_cents && booking.charged_cents > 0) {
    return {
      message: `Class confirmed for ${booking.profiles.full_name}. Credits were already held at booking.`,
    }
  }

  const newBalance = balanceCents - charge
  if (newBalance < 0) {
    return {
      message: `Class confirmed. ${formatCredits(charge)} deducted. ${booking.profiles.full_name} now owes ${formatSignedCredits(Math.abs(newBalance))}.`,
    }
  }

  return {
    message: `Class confirmed for ${booking.profiles.full_name}.`,
  }
}

export async function cancelBookingForAdmin(
  bookingId: string,
  studentName: string,
  comment: string | null,
): Promise<string> {
  await cancelBooking(bookingId, comment)
  return `Class cancelled for ${studentName}.`
}
