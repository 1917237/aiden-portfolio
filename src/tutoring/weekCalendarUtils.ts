import { getDateAvailabilityState } from './generateSlots'
import { SCHEDULE_END_HOUR, SCHEDULE_START_HOUR, SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import type { Blockout, DateAvailability, WeeklyCell } from './scheduleTypes'
import { formatDateKey } from './calendarUtils'
import { isoToZonedParts } from './timezoneUtils'

export const WEEK_ROW_HEIGHT_PX = 14

export type WeekCellState = 'blocked' | 'available' | 'unavailable' | 'extra'

export type WeekDay = {
  dateKey: string
  dayOfWeek: number
  dayNumber: number
  label: string
  isToday: boolean
}

export function getWeekDays(weekStart: Date): WeekDay[] {
  const todayKey = formatDateKey(new Date())
  const days: WeekDay[] = []

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    const dateKey = formatDateKey(date)
    days.push({
      dateKey,
      dayOfWeek: date.getDay(),
      dayNumber: date.getDate(),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      isToday: dateKey === todayKey,
    })
  }

  return days
}

export function startOfWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - day)
  start.setHours(0, 0, 0, 0)
  return start
}

export function formatWeekRange(weekStart: Date) {
  const end = new Date(weekStart)
  end.setDate(weekStart.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' }
  if (weekStart.getMonth() === end.getMonth()) {
    return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${weekStart.toLocaleDateString(undefined, yearOpts)} – ${end.toLocaleDateString(undefined, yearOpts)}`
}

export const WEEK_TIME_SLOTS = Array.from(
  { length: ((SCHEDULE_END_HOUR - SCHEDULE_START_HOUR) * 60) / SLOT_INTERVAL_MINUTES },
  (_, index) => SCHEDULE_START_HOUR * 60 + index * SLOT_INTERVAL_MINUTES,
)

export function getWeekCellState(
  dateKey: string,
  dayOfWeek: number,
  startMinutes: number,
  weeklyCells: WeeklyCell[],
  dateExtras: DateAvailability[],
  blockouts: Blockout[],
): WeekCellState {
  const state = getDateAvailabilityState(dateKey, dayOfWeek, weeklyCells, dateExtras, blockouts)

  if (state.extras.has(startMinutes)) return 'extra'
  if (state.wholeDayBlocked) return 'blocked'
  if (state.available.has(startMinutes)) return 'available'
  if (state.blocked.has(startMinutes)) return 'blocked'
  return 'unavailable'
}

export function minutesToTopPx(startMinutes: number) {
  const gridStart = SCHEDULE_START_HOUR * 60
  const slotIndex = (startMinutes - gridStart) / SLOT_INTERVAL_MINUTES
  return slotIndex * WEEK_ROW_HEIGHT_PX
}

export function durationToHeightPx(startMinutes: number, endMinutes: number) {
  return ((endMinutes - startMinutes) / SLOT_INTERVAL_MINUTES) * WEEK_ROW_HEIGHT_PX
}

export function isoToMinutes(iso: string, timeZone?: string) {
  if (!timeZone) {
    const date = new Date(iso)
    return date.getHours() * 60 + date.getMinutes()
  }
  return isoToZonedParts(iso, timeZone).startMinutes
}
