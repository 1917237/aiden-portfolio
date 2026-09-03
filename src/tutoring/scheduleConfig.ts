/** First hour shown on the weekly grid (24h). */
export const SCHEDULE_START_HOUR = 8

/** Last hour on the grid (24h). 24 = midnight. */
export const SCHEDULE_END_HOUR = 24

/** Grid cell size in minutes. */
export const SLOT_INTERVAL_MINUTES = 15

/** Length of one bookable class. */
export const CLASS_DURATION_MINUTES = 60

/** How many weeks ahead to generate bookable slots (covers weekly 4-week booking). */
export const WEEKS_AHEAD = 6

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const SCHEDULE_HOURS = Array.from(
  { length: SCHEDULE_END_HOUR - SCHEDULE_START_HOUR },
  (_, i) => SCHEDULE_START_HOUR + i,
)

export const SLOT_OFFSETS = [0, 15, 30, 45] as const

export const TIME_SLOTS = SCHEDULE_HOURS.flatMap((hour) =>
  SLOT_OFFSETS.map((offset) => hour * 60 + offset),
)

export function formatTimeLabel(startMinutes: number) {
  const hour = Math.floor(startMinutes / 60)
  const minute = startMinutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  if (minute === 0) return `${displayHour} ${period}`
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

export function cellKey(dayOfWeek: number, startMinutes: number) {
  return `${dayOfWeek}-${startMinutes}`
}

export function parseCellKey(key: string): { dayOfWeek: number; startMinutes: number } {
  const dash = key.indexOf('-')
  return {
    dayOfWeek: Number(key.slice(0, dash)),
    startMinutes: Number(key.slice(dash + 1)),
  }
}
