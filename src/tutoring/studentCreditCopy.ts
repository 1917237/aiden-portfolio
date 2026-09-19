/**
 * Student-facing credit copy.
 * Must match DB behavior (hold at book; refund on early cancel; no refund within 12h).
 */

import { LATE_CANCEL_HOURS } from './lateCancelPolicy'

export const STUDENT_CREDITS_POLICY =
  `Credits leave your balance when you book. Cancel at least ${LATE_CANCEL_HOURS} hours before class and they come back; cancel inside ${LATE_CANCEL_HOURS} hours and they stay used. Your balance can go negative if you book before paying. That means you still owe payment to your tutor, not a second charge for the same class. After class, your tutor marks it complete. That does not charge you again.`

export const STUDENT_BOOKING_CREDIT_HINT =
  `Credits leave your balance as soon as you book. Cancel ${LATE_CANCEL_HOURS}+ hours ahead to get them back.`

export const STUDENT_PAY_LATER_HINT =
  'Credits are reserved now. Your balance may go negative. That balance is what you still owe your tutor (not an extra class charge). Send payment, then request credits to bring it back up.'

export const STUDENT_NEGATIVE_BALANCE_HINT =
  'This is what you still owe your tutor after classes already booked. Send payment, then request credits below. You are not paying for those classes twice.'
