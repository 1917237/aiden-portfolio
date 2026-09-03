export type CalendarIcsEvent = {
  uid: string
  title: string
  description?: string | null
  startAt: string
  endAt: string
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toIcsUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function buildIcsCalendar(events: CalendarIcsEvent[], calendarName = 'Tutoring') {
  const stamp = toIcsUtc(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tutoring App//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(event.startAt)}`,
      `DTEND:${toIcsUtc(event.endAt)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    )
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    }
    lines.push(
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Tutoring lesson in 30 minutes',
      'END:VALARM',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

export function downloadIcsFile(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function calendarFeedHttpsUrl(supabaseUrl: string, token: string) {
  const base = supabaseUrl.replace(/\/$/, '')
  return `${base}/functions/v1/calendar-feed?token=${encodeURIComponent(token)}`
}

export function calendarFeedWebcalUrl(httpsUrl: string) {
  return httpsUrl.replace(/^https:/i, 'webcal:')
}

export function googleCalendarSubscribeUrl(httpsFeedUrl: string) {
  return `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(httpsFeedUrl)}`
}

export function lessonToIcsEvent(lesson: {
  id: string
  start_time: string
  duration_minutes: number
  title?: string
  description?: string | null
}): CalendarIcsEvent {
  const startAt = lesson.start_time
  const endAt = new Date(
    new Date(startAt).getTime() + lesson.duration_minutes * 60_000,
  ).toISOString()
  return {
    uid: `booking-${lesson.id}@tutoring`,
    title: lesson.title ?? 'Tutoring lesson',
    description: lesson.description ?? null,
    startAt,
    endAt,
  }
}
