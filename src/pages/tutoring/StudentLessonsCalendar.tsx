import { useMemo, useState } from 'react'
import { MAX_MONTH_CELL_EVENTS } from '../../tutoring/calendarDayEvents'
import { formatMonthYear, getMonthGrid } from '../../tutoring/calendarUtils'
import {
  addDaysToDateKey,
  formatTimeInTimezone,
  formatWeekRangeFromKeys,
  getDateKeyInTimezone,
  getWeekDaysForTimezone,
  isoToZonedParts,
  startOfWeekFromDateKey,
} from '../../tutoring/timezoneUtils'

export type StudentLesson = {
  id: string
  status: 'booked' | 'completed' | 'cancelled'
  pay_later: boolean
  duration_minutes: number
  start_time: string
  end_time: string
}

type ViewMode = 'week' | 'month'

type Props = {
  lessons: StudentLesson[]
  timeZone: string
  onSelectLesson?: (lesson: StudentLesson) => void
}

const WEEK_START_HOUR = 8
/** Grid runs 8:00 AM through midnight (12 AM), one row per hour. */
const WEEK_END_HOUR = 24
const HOUR_HEIGHT_PX = 56
const TIME_COLUMN_WIDTH = 56
const GRID_START_MINUTES = WEEK_START_HOUR * 60
const GRID_END_MINUTES = WEEK_END_HOUR * 60

function formatHourLabel(hour: number) {
  const normalized = hour % 24
  const period = normalized >= 12 ? 'PM' : 'AM'
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12
  return `${hour12} ${period}`
}

function lessonDurationMinutes(startIso: string, endIso: string) {
  return Math.max(15, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
}

function lessonVisibleInGrid(startIso: string, endIso: string, timeZone: string) {
  const { startMinutes } = isoToZonedParts(startIso, timeZone)
  const endMinutes = startMinutes + lessonDurationMinutes(startIso, endIso)
  return startMinutes < GRID_END_MINUTES && endMinutes > GRID_START_MINUTES
}

function lessonStyle(startIso: string, endIso: string, timeZone: string) {
  const { startMinutes } = isoToZonedParts(startIso, timeZone)
  const endMinutes = startMinutes + lessonDurationMinutes(startIso, endIso)
  const visibleStart = Math.max(startMinutes, GRID_START_MINUTES)
  const visibleEnd = Math.min(endMinutes, GRID_END_MINUTES)
  if (visibleEnd <= visibleStart) return null

  const top = ((visibleStart - GRID_START_MINUTES) / 60) * HOUR_HEIGHT_PX
  const height = Math.max(28, ((visibleEnd - visibleStart) / 60) * HOUR_HEIGHT_PX)
  return { top, height }
}

function lessonChipClass(status: StudentLesson['status']) {
  if (status === 'completed') return 'border-sage/40 bg-sage/20 text-ink'
  return 'border-sage-deep bg-sage text-white'
}

export function StudentLessonsCalendar({ lessons, timeZone, onSelectLesson }: Props) {
  const todayKey = getDateKeyInTimezone(new Date(), timeZone)
  const [view, setView] = useState<ViewMode>('week')
  const [weekStartKey, setWeekStartKey] = useState(() => startOfWeekFromDateKey(todayKey))
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const [year, month] = todayKey.split('-').map(Number)
    return { year, month: month - 1 }
  })

  const activeLessons = useMemo(
    () => lessons.filter((lesson) => lesson.status !== 'cancelled'),
    [lessons],
  )

  const weekDays = useMemo(
    () => getWeekDaysForTimezone(weekStartKey, timeZone),
    [weekStartKey, timeZone],
  )
  const weekEndKey = addDaysToDateKey(weekStartKey, 6)

  const weekLessons = useMemo(() => {
    return activeLessons.filter((lesson) => {
      const dateKey = getDateKeyInTimezone(lesson.start_time, timeZone)
      return dateKey >= weekStartKey && dateKey <= weekEndKey
    })
  }, [activeLessons, timeZone, weekEndKey, weekStartKey])

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, StudentLesson[]>()
    for (const day of weekDays) {
      map.set(day.dateKey, [])
    }
    for (const lesson of weekLessons) {
      const dateKey = getDateKeyInTimezone(lesson.start_time, timeZone)
      const dayLessons = map.get(dateKey)
      if (dayLessons) dayLessons.push(lesson)
    }
    for (const dayLessons of map.values()) {
      dayLessons.sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      )
    }
    return map
  }, [weekDays, weekLessons, timeZone])

  const monthDays = useMemo(
    () => getMonthGrid(monthAnchor.year, monthAnchor.month),
    [monthAnchor.month, monthAnchor.year],
  )

  const monthLessonsByDay = useMemo(() => {
    const map = new Map<string, StudentLesson[]>()
    for (const lesson of activeLessons) {
      const dateKey = getDateKeyInTimezone(lesson.start_time, timeZone)
      const existing = map.get(dateKey) ?? []
      existing.push(lesson)
      map.set(dateKey, existing)
    }
    for (const dayLessons of map.values()) {
      dayLessons.sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      )
    }
    return map
  }, [activeLessons, timeZone])

  const hourLabels = useMemo(() => {
    const hours: number[] = []
    for (let hour = WEEK_START_HOUR; hour < WEEK_END_HOUR; hour += 1) {
      hours.push(hour)
    }
    return hours
  }, [])

  const gridHeight = hourLabels.length * HOUR_HEIGHT_PX

  function goToToday() {
    const nextToday = getDateKeyInTimezone(new Date(), timeZone)
    setWeekStartKey(startOfWeekFromDateKey(nextToday))
    const [year, month] = nextToday.split('-').map(Number)
    setMonthAnchor({ year, month: month - 1 })
  }

  function shiftWeek(delta: number) {
    setWeekStartKey((current) => addDaysToDateKey(current, delta * 7))
  }

  function shiftMonth(delta: number) {
    setMonthAnchor((current) => {
      const next = new Date(current.year, current.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  return (
    <section className="mt-10 border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="font-display text-2xl font-semibold tracking-tight">Your classes</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Upcoming and past lessons in your selected timezone.
          </p>
        </div>

        <div className="flex border border-line">
          {(['week', 'month'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={`px-4 py-2 text-sm font-semibold capitalize ${
                view === mode ? 'bg-sage text-white' : 'bg-white hover:bg-bg-elevated'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (view === 'week' ? shiftWeek(-1) : shiftMonth(-1))}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
            aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
          >
            ←
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => (view === 'week' ? shiftWeek(1) : shiftMonth(1))}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
            aria-label={view === 'week' ? 'Next week' : 'Next month'}
          >
            →
          </button>
        </div>

        <h4 className="font-semibold">
          {view === 'week'
            ? formatWeekRangeFromKeys(weekStartKey, timeZone)
            : formatMonthYear(monthAnchor.year, monthAnchor.month)}
        </h4>
      </div>

      {activeLessons.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">No classes scheduled yet.</p>
      ) : view === 'week' ? (
        <div className="mt-4 w-full border border-line bg-white">
          <div className="w-full">
            <div className="flex border-b border-line bg-bg-elevated/30">
              <div className="shrink-0" style={{ width: TIME_COLUMN_WIDTH }} />
              {weekDays.map((day) => (
                <div
                  key={day.dateKey}
                  className={`flex-1 border-l border-line px-2 py-3 text-center ${
                    day.isToday ? 'bg-sage/10' : ''
                  }`}
                >
                  <p className="text-xs font-semibold uppercase text-ink-muted">{day.label}</p>
                  <p className="text-lg font-semibold">{day.dayNumber}</p>
                </div>
              ))}
            </div>

            <div className="flex w-full">
              <div
                className="shrink-0 bg-bg-elevated/40"
                style={{ width: TIME_COLUMN_WIDTH, height: gridHeight }}
              >
                {hourLabels.map((hour) => (
                  <div
                    key={hour}
                    className="box-border border-b border-line pr-2 text-right text-[11px] leading-none text-ink-muted"
                    style={{ height: HOUR_HEIGHT_PX, paddingTop: 4 }}
                  >
                    {formatHourLabel(hour)}
                  </div>
                ))}
              </div>

              <div className="flex flex-1">
                {weekDays.map((day) => {
                  const dayLessons = lessonsByDay.get(day.dateKey) ?? []
                  return (
                    <div
                      key={day.dateKey}
                      className={`relative flex-1 border-l border-line ${
                        day.isToday ? 'bg-sage/5' : ''
                      }`}
                      style={{ height: gridHeight }}
                    >
                      {hourLabels.map((hour) => (
                        <div
                          key={hour}
                          className="box-border border-b border-line"
                          style={{ height: HOUR_HEIGHT_PX }}
                        />
                      ))}
                      {dayLessons
                        .filter((lesson) =>
                          lessonVisibleInGrid(lesson.start_time, lesson.end_time, timeZone),
                        )
                        .map((lesson) => {
                        const style = lessonStyle(lesson.start_time, lesson.end_time, timeZone)
                        if (!style) return null
                        return (
                          <button
                            key={lesson.id}
                            type="button"
                            onClick={() => onSelectLesson?.(lesson)}
                            className={`absolute inset-x-1 overflow-hidden border px-2 py-1 text-left text-[11px] leading-tight ${lessonChipClass(lesson.status)} ${
                              onSelectLesson ? 'cursor-pointer hover:brightness-95' : ''
                            }`}
                            style={{ top: style.top, height: style.height }}
                          >
                            <p className="font-semibold">
                              {formatTimeInTimezone(lesson.start_time, timeZone)}
                            </p>
                            <p className="truncate opacity-90">
                              {lesson.status === 'booked' ? 'Scheduled' : 'Completed'}
                              {lesson.pay_later ? ' · pay later' : ''}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 border border-line bg-white">
          <div className="grid grid-cols-7 border-b border-line bg-bg-elevated/30 text-center text-xs font-semibold uppercase text-ink-muted">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
              <div key={label} className="border-l border-line px-2 py-2 first:border-l-0">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const dayLessons = monthLessonsByDay.get(day.dateKey) ?? []
              const visible = dayLessons.slice(0, MAX_MONTH_CELL_EVENTS)
              const hiddenCount = dayLessons.length - visible.length
              const isToday = day.dateKey === todayKey

              return (
                <div
                  key={`${day.dateKey}-${day.inMonth}`}
                  className={`min-h-[7rem] border-l border-t border-line p-2 ${
                    day.inMonth ? 'bg-white' : 'bg-bg-elevated/40 text-ink-muted/70'
                  } ${isToday ? 'ring-1 ring-inset ring-sage' : ''}`}
                >
                  <p className={`text-sm font-semibold ${isToday ? 'text-sage-deep' : ''}`}>
                    {day.dayNumber}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {visible.map((lesson) => (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => onSelectLesson?.(lesson)}
                          className={`w-full truncate border px-1.5 py-0.5 text-left text-[10px] font-medium ${lessonChipClass(lesson.status)} ${
                            onSelectLesson ? 'cursor-pointer hover:brightness-95' : ''
                          }`}
                        >
                          {formatTimeInTimezone(lesson.start_time, timeZone)}
                          {lesson.status === 'booked' ? '' : ' · done'}
                        </button>
                      </li>
                    ))}
                    {hiddenCount > 0 ? (
                      <li className="text-[10px] text-ink-muted">+{hiddenCount} more</li>
                    ) : null}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
