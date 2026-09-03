export type InsightRange = '7d' | '30d' | '1y' | 'ytd' | 'all'

export type CompletedLesson = {
  chargedCents: number
  startTime: string
  endTime: string
  completedAt: string | null
}

export type ChartPoint = {
  key: string
  label: string
  incomeCents: number
}

export type InsightTotals = {
  incomeCents: number
  lessons: number
  hoursTaught: number
  totalStudents: number
  totalEarningsCents: number
  journeyStart: Date | null
}

function startOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function dayKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function formatDayLabel(date: Date, compact: boolean) {
  if (compact) {
    return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

export function lessonDurationMinutes(lesson: CompletedLesson) {
  const start = new Date(lesson.startTime).getTime()
  const end = new Date(lesson.endTime).getTime()
  const minutes = (end - start) / (60 * 1000)
  return minutes > 0 ? minutes : 60
}

function incomeDate(lesson: CompletedLesson) {
  return new Date(lesson.completedAt ?? lesson.startTime)
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime())
}

function bucketKey(date: Date, range: InsightRange) {
  return range === '7d' || range === '30d' ? dayKey(date) : monthKey(date)
}

function validLessons(lessons: CompletedLesson[]) {
  return lessons.filter((lesson) => isValidDate(incomeDate(lesson)))
}

export function sumChartIncome(points: ChartPoint[]) {
  return points.reduce((sum, point) => sum + point.incomeCents, 0)
}

/** Running total so the chart top matches period income (not just the busiest day/month). */
export function toCumulativePoints(points: ChartPoint[]): ChartPoint[] {
  let running = 0
  return points.map((point) => {
    running += point.incomeCents
    return { ...point, incomeCents: running }
  })
}

export function getRangeStart(range: InsightRange, now = new Date()): Date | null {
  const today = startOfDay(now)
  switch (range) {
    case '7d':
      return addDays(today, -6)
    case '30d':
      return addDays(today, -29)
    case '1y':
      return addMonths(today, -11)
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1)
    case 'all':
      return null
  }
}

function endOfDay(date: Date) {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function lessonsInIncomeRange(
  lessons: CompletedLesson[],
  rangeStart: Date | null,
  rangeEnd: Date | null,
) {
  return validLessons(lessons).filter((lesson) => {
    const at = incomeDate(lesson).getTime()
    if (rangeStart && at < startOfDay(rangeStart).getTime()) return false
    if (rangeEnd && at > endOfDay(rangeEnd).getTime()) return false
    return true
  })
}

function lessonsInLessonRange(
  lessons: CompletedLesson[],
  rangeStart: Date | null,
  rangeEnd: Date | null,
) {
  return lessons.filter((lesson) => {
    const at = new Date(lesson.startTime).getTime()
    if (rangeStart && at < startOfDay(rangeStart).getTime()) return false
    if (rangeEnd && at > endOfDay(rangeEnd).getTime()) return false
    return true
  })
}

function earliestIncomeDate(lessons: CompletedLesson[]) {
  if (lessons.length === 0) return null
  const sorted = [...lessons].sort(
    (a, b) => incomeDate(a).getTime() - incomeDate(b).getTime(),
  )
  return incomeDate(sorted[0])
}

function bucketLessons(
  lessons: CompletedLesson[],
  range: InsightRange,
  rangeStart: Date | null,
  rangeEnd: Date | null,
) {
  const incomeByKey = new Map<string, number>()
  const filtered = lessonsInIncomeRange(lessons, rangeStart, rangeEnd)

  for (const lesson of filtered) {
    const date = incomeDate(lesson)
    const key = bucketKey(date, range)
    incomeByKey.set(key, (incomeByKey.get(key) ?? 0) + lesson.chargedCents)
  }

  return { incomeByKey, filtered }
}

export function buildChartPoints(
  lessons: CompletedLesson[],
  range: InsightRange,
  now = new Date(),
): ChartPoint[] {
  const rangeStart = getRangeStart(range, now)
  const rangeEnd = range === 'all' ? null : now
  const { incomeByKey } = bucketLessons(lessons, range, rangeStart, rangeEnd)
  const points: ChartPoint[] = []

  if (range === '7d') {
    const start = rangeStart ?? startOfDay(now)
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i)
      const key = dayKey(date)
      points.push({
        key,
        label: formatDayLabel(date, false),
        incomeCents: incomeByKey.get(key) ?? 0,
      })
    }
    return points
  }

  if (range === '30d') {
    const start = rangeStart ?? addDays(startOfDay(now), -29)
    for (let i = 0; i < 30; i++) {
      const date = addDays(start, i)
      const key = dayKey(date)
      points.push({
        key,
        label: i % 5 === 0 || i === 29 ? formatDayLabel(date, true) : '',
        incomeCents: incomeByKey.get(key) ?? 0,
      })
    }
    return points
  }

  if (range === '1y') {
    const start = startOfMonth(addMonths(now, -11))
    for (let i = 0; i < 12; i++) {
      const date = addMonths(start, i)
      const key = monthKey(date)
      points.push({
        key,
        label: formatMonthLabel(date),
        incomeCents: incomeByKey.get(key) ?? 0,
      })
    }
    return points
  }

  if (range === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1)
    let cursor = startOfMonth(start)
    while (cursor <= now) {
      const key = monthKey(cursor)
      points.push({
        key,
        label: formatMonthLabel(cursor),
        incomeCents: incomeByKey.get(key) ?? 0,
      })
      cursor = addMonths(cursor, 1)
    }
    return points
  }

  const datedLessons = validLessons(lessons)
  if (datedLessons.length === 0) {
    return [
      {
        key: monthKey(now),
        label: formatMonthLabel(now),
        incomeCents: 0,
      },
    ]
  }

  const timestamps = datedLessons.map((lesson) => incomeDate(lesson).getTime())
  const earliest = new Date(Math.min(...timestamps))
  const first = startOfMonth(earliest)
  const last = startOfMonth(now)

  let cursor = first
  while (cursor <= last) {
    const key = monthKey(cursor)
    points.push({
      key,
      label: formatMonthLabel(cursor),
      incomeCents: incomeByKey.get(key) ?? 0,
    })
    cursor = addMonths(cursor, 1)
  }

  return points
}

export function computeInsightTotals(
  lessons: CompletedLesson[],
  totalStudents: number,
  range: InsightRange,
  now = new Date(),
): InsightTotals {
  const rangeStart = getRangeStart(range, now)
  const rangeEnd = range === 'all' ? null : now
  const chartPoints = buildChartPoints(lessons, range, now)
  const inIncomeRange = lessonsInIncomeRange(lessons, rangeStart, rangeEnd)
  const inLessonRange = lessonsInLessonRange(lessons, rangeStart, rangeEnd)
  const incomeCents = sumChartIncome(chartPoints)
  const hoursTaught = inLessonRange.reduce(
    (sum, lesson) => sum + lessonDurationMinutes(lesson) / 60,
    0,
  )

  return {
    incomeCents,
    lessons: inIncomeRange.length,
    hoursTaught,
    totalStudents,
    totalEarningsCents: validLessons(lessons).reduce(
      (sum, lesson) => sum + lesson.chargedCents,
      0,
    ),
    journeyStart: earliestIncomeDate(validLessons(lessons)),
  }
}

export function formatAxisMoney(cents: number) {
  const dollars = cents / 100
  if (dollars >= 10_000) return `$${Math.round(dollars / 1000)}k`
  return `$${Math.round(dollars)}`
}

export function formatHours(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(1)
}
