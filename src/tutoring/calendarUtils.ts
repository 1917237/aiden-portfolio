export function formatDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

export function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export type CalendarDay = {
  dateKey: string
  dayNumber: number
  inMonth: boolean
}

export function getMonthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startPad = first.getDay()
  const days: CalendarDay[] = []

  for (let i = startPad - 1; i >= 0; i--) {
    const date = new Date(year, month, -i)
    days.push({ dateKey: formatDateKey(date), dayNumber: date.getDate(), inMonth: false })
  }

  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(year, month, day)
    days.push({ dateKey: formatDateKey(date), dayNumber: day, inMonth: true })
  }

  while (days.length % 7 !== 0) {
    const next = days.length - startPad - last.getDate() + 1
    const date = new Date(year, month + 1, next)
    days.push({ dateKey: formatDateKey(date), dayNumber: date.getDate(), inMonth: false })
  }

  return days
}

export function formatTimeShort(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatDayLabel(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
