import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'tutoring-display-timezone'

export const COMMON_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

export function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function loadDisplayTimezone() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return saved
  } catch {
    // ignore
  }
  return getBrowserTimezone()
}

export function saveDisplayTimezone(timeZone: string) {
  try {
    localStorage.setItem(STORAGE_KEY, timeZone)
  } catch {
    // ignore
  }
}

/** Profile timezone wins, then browser localStorage, then device default. */
export function resolveDisplayTimezone(profileTimezone?: string | null) {
  if (profileTimezone?.trim()) {
    return profileTimezone.trim()
  }
  return loadDisplayTimezone()
}

export async function persistDisplayTimezone(timeZone: string) {
  saveDisplayTimezone(timeZone)
  const { error } = await supabase.rpc('update_my_display_timezone', {
    p_timezone: timeZone,
  })
  if (error) {
    if (
      error.message.includes('update_my_display_timezone') ||
      error.message.includes('display_timezone')
    ) {
      return
    }
    throw error
  }
}

export function getDateKeyInTimezone(isoOrDate: string | Date, timeZone: string) {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function getTimezoneOffsetLabel(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date)
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

export function formatTimezoneLabel(timeZone: string) {
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone
  const offset = getTimezoneOffsetLabel(timeZone)
  return offset ? `${city} (${offset})` : city
}

export function isoToZonedParts(iso: string, timeZone: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date)

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  const hour12 = Number(read('hour'))
  const minute = Number(read('minute'))
  const dayPeriod = read('dayPeriod') as 'AM' | 'PM'
  const hour24 =
    dayPeriod === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12

  return {
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
    startMinutes: hour24 * 60 + minute,
    hour12,
    minute,
    period: dayPeriod,
  }
}

export function formatTimeInTimezone(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatSlotTimeParts(iso: string, timeZone: string) {
  const { hour12, minute, period } = isoToZonedParts(iso, timeZone)
  const time =
    minute === 0 ? String(hour12) : `${hour12}:${String(minute).padStart(2, '0')}`
  return { time, period }
}

export function startOfWeekFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return civilDateKeyFromUtc(date)
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
  date.setUTCDate(date.getUTCDate() + days)
  return civilDateKeyFromUtc(date)
}

function civilDateKeyFromUtc(date: Date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatWeekRangeFromKeys(weekStartKey: string, _timeZone?: string) {
  const weekEndKey = addDaysToDateKey(weekStartKey, 6)
  const [sy, sm, sd] = weekStartKey.split('-').map(Number)
  const [ey, em, ed] = weekEndKey.split('-').map(Number)
  const start = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0, 0))
  const end = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0, 0))
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  }
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' }
  const startMonth = start.getUTCMonth()
  const endMonth = end.getUTCMonth()

  if (startMonth === endMonth) {
    const startLabel = start.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
    const endDay = end.getUTCDate()
    const year = end.getUTCFullYear()
    return `${startLabel} – ${endDay}, ${year}`
  }

  return `${start.toLocaleDateString('en-US', { ...yearOpts, timeZone: 'UTC' })} – ${end.toLocaleDateString('en-US', { ...yearOpts, timeZone: 'UTC' })}`
}

export type ZonedWeekDay = {
  dateKey: string
  dayOfWeek: number
  dayNumber: number
  label: string
  isToday: boolean
}

export function getWeekDaysForTimezone(weekStartKey: string, timeZone: string): ZonedWeekDay[] {
  const todayKey = getDateKeyInTimezone(new Date(), timeZone)
  const days: ZonedWeekDay[] = []

  for (let i = 0; i < 7; i += 1) {
    const dateKey = addDaysToDateKey(weekStartKey, i)
    const dayOfWeek = dayOfWeekFromDateKey(dateKey)
    days.push({
      dateKey,
      dayOfWeek,
      dayNumber: Number(dateKey.slice(8, 10)),
      label: weekdayLabelFromDateKey(dateKey),
      isToday: dateKey === todayKey,
    })
  }

  return days
}

function zonedPartsFromUtcMs(utcMs: number, timeZone: string) {
  return isoToZonedParts(new Date(utcMs).toISOString(), timeZone)
}

/**
 * Convert a civil date + minutes-from-midnight in an IANA timezone to a UTC ISO string.
 */
export function zonedCivilToIso(dateKey: string, startMinutes: number, timeZone: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const hour = Math.floor(startMinutes / 60)
  const minute = startMinutes % 60

  // Initial guess: treat the wall time as UTC, then correct using the zone offset.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0)

  for (let i = 0; i < 4; i += 1) {
    const parts = zonedPartsFromUtcMs(utcMs, timeZone)
    const [py, pm, pd] = parts.dateKey.split('-').map(Number)
    const gotMs = Date.UTC(py, pm - 1, pd, Math.floor(parts.startMinutes / 60), parts.startMinutes % 60, 0, 0)
    const wantMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
    const delta = wantMs - gotMs
    if (delta === 0) break
    utcMs += delta
  }

  return new Date(utcMs).toISOString()
}

export function dayOfWeekFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).getUTCDay()
}

function weekdayLabelFromDateKey(dateKey: string) {
  const dow = dayOfWeekFromDateKey(dateKey)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] ?? ''
}
