/**
 * Student-facing credit copy.
 * Must match DB behavior in supabase/40-cancel-credit-refund.sql:
 * - Every booking: hold_credits_for_lesson() deducts balance at book time (may go negative)
 * - Cancel: release_booking_credits() refunds the hold
 * - Tutor confirm: complete_booking() does NOT charge again if already held
 * - Pay later: same hold; pay_later flag means you still owe your tutor payment
 */

export const STUDENT_CREDITS_POLICY =
  'Credits leave your balance when you book and come back if you cancel. Your balance can go negative if you book before paying. After class, your tutor marks it complete — that does not charge you again.'

export const STUDENT_BOOKING_CREDIT_HINT =
  'Credits leave your balance as soon as you book (refunded if you cancel).'

export const STUDENT_PAY_LATER_HINT =
  'Credits are reserved now — your balance may go negative. Send payment to your tutor, then request credits to bring it back up.'
