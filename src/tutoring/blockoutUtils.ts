import { CLASS_DURATION_MINUTES, SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import type { Blockout, DateAvailability } from './scheduleTypes'

function blockoutDateKey(blockout: Blockout) {
  return String(blockout.blockout_date).slice(0, 10)
}

export function isClassTimeBlocked(
  dateKey: string,
  startMinutes: number,
  blockouts: Blockout[],
  durationMinutes = CLASS_DURATION_MINUTES,
  dateExtras: DateAvailability[] = [],
) {
  const extras = new Set(
    dateExtras
      .filter((e) => String(e.availability_date).slice(0, 10) === dateKey)
      .map((e) => e.start_minutes),
  )
  const wholeDay = blockouts.some(
    (b) => blockoutDateKey(b) === dateKey && b.start_minutes === null,
  )

  for (let m = startMinutes; m < startMinutes + durationMinutes; m += SLOT_INTERVAL_MINUTES) {
    if (extras.has(m)) continue
    if (wholeDay) return true
    if (blockouts.some((b) => blockoutDateKey(b) === dateKey && b.start_minutes === m)) {
      return true
    }
  }

  return false
}

export function localDateTimeToIso(dateKey: string, startMinutes: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const hour = Math.floor(startMinutes / 60)
  const minute = startMinutes % 60
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + CLASS_DURATION_MINUTES)
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() }
}

export function isoToLocalParts(iso: string) {
  const date = new Date(iso)
  const dateKey = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  const startMinutes = date.getHours() * 60 + date.getMinutes()
  const hour24 = date.getHours()
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  const minute = date.getMinutes()
  return { dateKey, startMinutes, hour12, minute, period: period as 'AM' | 'PM' }
}
