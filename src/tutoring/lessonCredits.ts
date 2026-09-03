import {
  DURATION_RATE_MULTIPLIER,
  type BookingDurationMinutes,
} from './bookingDurationConfig'

/** One credit = one standard 50-minute lesson at the student's class rate. */
export function centsToLessonCredits(cents: number, classRateCents: number) {
  if (classRateCents <= 0) return 0
  return cents / classRateCents
}

export function lessonCreditsToCents(credits: number, classRateCents: number) {
  return Math.round(credits * classRateCents)
}

export function lessonCreditsForDuration(durationMinutes: number) {
  const multiplier =
    DURATION_RATE_MULTIPLIER[durationMinutes as BookingDurationMinutes] ?? 1
  return multiplier
}

function formatCreditNumber(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatLessonCredits(credits: number) {
  const abs = Math.abs(credits)
  const amount = formatCreditNumber(abs)
  const unit = abs === 1 ? 'credit' : 'credits'
  return credits < 0 ? `-${amount} ${unit}` : `${amount} ${unit}`
}
