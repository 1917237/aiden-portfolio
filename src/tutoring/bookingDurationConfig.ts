/** Student-selectable lesson lengths (minutes). */
export const BOOKING_DURATION_OPTIONS = [25, 50, 80, 110] as const

export type BookingDurationMinutes = (typeof BOOKING_DURATION_OPTIONS)[number]

export const DEFAULT_BOOKING_DURATION_MINUTES: BookingDurationMinutes = 50

/** Map stored lesson length to a selectable option, else 50 min. */
export function resolveBookingDuration(
  minutes: number | null | undefined,
): BookingDurationMinutes {
  return BOOKING_DURATION_OPTIONS.includes(minutes as BookingDurationMinutes)
    ? (minutes as BookingDurationMinutes)
    : DEFAULT_BOOKING_DURATION_MINUTES
}

export const WEEKLY_LESSON_COUNT = 4

/** Price multiplier vs the student's standard 50-min class rate. */
export const DURATION_RATE_MULTIPLIER: Record<BookingDurationMinutes, number> = {
  25: 0.5,
  50: 1,
  80: 1.5,
  110: 2,
}

export function formatDurationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (remainder === 0) return hours === 1 ? '1 hour' : `${hours} hours`
  if (hours === 1) return `1 hour ${remainder} min`
  return `${hours} hours ${remainder} min`
}

export function lessonCostCents(classRateCents: number, durationMinutes: number) {
  const multiplier =
    DURATION_RATE_MULTIPLIER[durationMinutes as BookingDurationMinutes] ?? 1
  return Math.round(classRateCents * multiplier)
}

/** Minutes of break after a lesson before the next student can start. */
export const LESSON_BREAK_MINUTES = 5

/**
 * Calendar block reserved for a lesson (lesson + break, rounded up to 15 min).
 * 25 → 30, 50 → 60, 80 → 90, 110 → 120
 */
export function occupiedMinutesForDuration(durationMinutes: number) {
  const raw = durationMinutes + LESSON_BREAK_MINUTES
  return Math.ceil(raw / 15) * 15
}
