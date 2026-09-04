import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDurationLabel } from '../../tutoring/bookingDurationConfig'
import { formatSlotRange } from '../../tutoring/format'
import { formatTimezoneLabel, getDateKeyInTimezone } from '../../tutoring/timezoneUtils'
import { supabase } from '../../lib/supabase'
import { CollapsibleSection } from './CollapsibleSection'
import type { StudentLesson } from './StudentLessonsCalendar'
import { LATE_CANCEL_AGREEMENT, LATE_CANCEL_HOURS, isLateCancel } from '../../tutoring/lateCancelPolicy'

type UpcomingLesson = {
  id: string
  series_id: string | null
  duration_minutes: number
  start_time: string
  end_time: string
  meeting_url: string | null
}

type WeeklySeriesRow = {
  id: string
  duration_minutes: number
  active: boolean
  rolling: boolean
}

type StopResult = {
  cancelled_count: number
  kept_count: number
  mode: string
  stop_on_date: string | null
}

type Props = {
  studentId: string
  timeZone: string
  refreshKey?: number
  onChanged?: () => void
  onSelectLesson?: (lesson: StudentLesson) => void
}

function lessonEndIso(startIso: string, durationMinutes: number) {
  return new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()
}

function todayDateInputValue(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const d = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

/** Matches stop_my_weekly_series: keep classes on/before stop date; cancel later ones. */
function lessonsCancelledByStop(
  seriesLessons: UpcomingLesson[],
  mode: 'now' | 'on_date',
  stopDate: string,
  timeZone: string,
) {
  if (mode === 'now') return seriesLessons
  return seriesLessons.filter(
    (lesson) => getDateKeyInTimezone(lesson.start_time, timeZone) > stopDate,
  )
}

export function StudentUpcomingPanel({
  studentId,
  timeZone,
  refreshKey = 0,
  onChanged,
  onSelectLesson,
}: Props) {
  const [lessons, setLessons] = useState<UpcomingLesson[]>([])
  const [series, setSeries] = useState<WeeklySeriesRow[]>([])
  const [loading, setLoading] = useState(true)
  const hasLoadedOnceRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [busySeriesId, setBusySeriesId] = useState<string | null>(null)
  const [stopDateBySeries, setStopDateBySeries] = useState<Record<string, string>>({})
  const [stopPolicyAgreedBySeries, setStopPolicyAgreedBySeries] = useState<Record<string, boolean>>(
    {},
  )
  const [stopPolicyShakeBySeries, setStopPolicyShakeBySeries] = useState<Record<string, boolean>>({})
  const [successBySeries, setSuccessBySeries] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true)
    setError(null)

    const [bookingsResult, seriesResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, series_id, duration_minutes, status, meeting_url, availability_slots(start_time, end_time)')
        .eq('student_id', studentId)
        .eq('status', 'booked'),
      supabase
        .from('weekly_series')
        .select('id, duration_minutes, active, rolling')
        .eq('student_id', studentId)
        .eq('active', true),
    ])

    let bookingRows = bookingsResult.data
    let bookingsError = bookingsResult.error

    if (bookingsError?.message.includes('meeting_url')) {
      const fallback = await supabase
        .from('bookings')
        .select('id, series_id, duration_minutes, status, availability_slots(start_time, end_time)')
        .eq('student_id', studentId)
        .eq('status', 'booked')
      bookingRows = fallback.data
      bookingsError = fallback.error
    }

    if (bookingsError) {
      setError(bookingsError.message)
      setLoading(false)
      return
    }

    if (seriesResult.error) {
      // Series table may not exist until migration 20
      if (
        !seriesResult.error.message.includes('weekly_series') &&
        seriesResult.error.code !== '42P01' &&
        seriesResult.error.code !== 'PGRST205'
      ) {
        setError(seriesResult.error.message)
        setLoading(false)
        return
      }
    }

    const now = Date.now()
    const upcoming: UpcomingLesson[] = []
    for (const row of bookingRows ?? []) {
      const slot = row.availability_slots as
        | { start_time: string; end_time: string }
        | { start_time: string; end_time: string }[]
        | null
      const start = Array.isArray(slot) ? slot[0]?.start_time : slot?.start_time
      if (!start) continue
      if (new Date(start).getTime() < now) continue
      const duration = row.duration_minutes ?? 50
      upcoming.push({
        id: row.id as string,
        series_id: (row.series_id as string | null) ?? null,
        duration_minutes: duration,
        start_time: start,
        end_time: lessonEndIso(start, duration),
        meeting_url: ((row as { meeting_url?: string | null }).meeting_url ?? null)?.trim() || null,
      })
    }
    upcoming.sort((a, b) => a.start_time.localeCompare(b.start_time))

    setLessons(upcoming)
    setSeries((seriesResult.data ?? []) as WeeklySeriesRow[])
    hasLoadedOnceRef.current = true
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const nextLesson = lessons[0] ?? null

  function openLesson(lesson: UpcomingLesson) {
    if (!onSelectLesson) return
    onSelectLesson({
      id: lesson.id,
      status: 'booked',
      duration_minutes: lesson.duration_minutes,
      start_time: lesson.start_time,
      end_time: lesson.end_time,
      meeting_url: lesson.meeting_url,
    })
  }

  const lessonButtonClass =
    'w-full text-left transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage'

  const seriesBlocks = useMemo(() => {
    return series
      .map((item) => {
        const upcoming = lessons.filter((lesson) => lesson.series_id === item.id).slice(0, 4)
        return { series: item, upcoming }
      })
      .filter((block) => block.upcoming.length > 0 || block.series.active)
  }, [lessons, series])

  async function stopSeries(seriesId: string, mode: 'now' | 'on_date') {
    setError(null)
    const stopDate = stopDateBySeries[seriesId] ?? todayDateInputValue(timeZone)
    const timeZoneLabel = formatTimezoneLabel(timeZone)
    const seriesLessons = lessons.filter((lesson) => lesson.series_id === seriesId)
    const toCancel = lessonsCancelledByStop(seriesLessons, mode, stopDate, timeZone)
    const lateAmongCancelled = toCancel.filter((lesson) => isLateCancel(lesson.start_time))
    const hasLateCancel = lateAmongCancelled.length > 0
    const lateCancelNote = hasLateCancel
      ? ` Any cancelled class within ${LATE_CANCEL_HOURS} hours of start will not get credits back (same as cancelling that class).`
      : ` Cancelled classes at least ${LATE_CANCEL_HOURS} hours before start get credits back; inside ${LATE_CANCEL_HOURS} hours they do not.`

    if (hasLateCancel && !stopPolicyAgreedBySeries[seriesId]) {
      setStopPolicyShakeBySeries((prev) => ({ ...prev, [seriesId]: true }))
      window.setTimeout(() => {
        setStopPolicyShakeBySeries((prev) => ({ ...prev, [seriesId]: false }))
      }, 450)
      setError('Check the late-cancel box before stopping this weekly series.')
      return
    }

    if (mode === 'now') {
      if (
        !window.confirm(
          `Stop this weekly series now? All upcoming classes in this series will be cancelled, and no new ones will be booked.${lateCancelNote}`,
        )
      ) {
        return
      }
    } else {
      if (!stopDate) {
        setError('Pick a stop date.')
        return
      }
      if (
        !window.confirm(
          `Stop this weekly series after ${stopDate} (${timeZoneLabel})? Classes on or before that day in your timezone stay; later ones are cancelled, and rolling stops.${lateCancelNote}`,
        )
      ) {
        return
      }
    }

    setBusySeriesId(seriesId)

    const { data, error: rpcError } = await supabase.rpc('stop_my_weekly_series', {
      p_series_id: seriesId,
      p_mode: mode,
      p_stop_on_date: mode === 'on_date' ? stopDate : null,
      p_stop_timezone: mode === 'on_date' ? timeZone : null,
    })

    setBusySeriesId(null)

    if (rpcError) {
      setError(
        rpcError.message.includes('Could not find the function')
          ? 'Run supabase/43-stop-weekly-student-timezone.sql in the Supabase SQL Editor, then try again.'
          : rpcError.message,
      )
      return
    }

    const result = data as StopResult
    const creditNote =
      result.cancelled_count === 0
        ? ''
        : lateAmongCancelled.length === 0
          ? ' Credits returned for cancelled classes.'
          : lateAmongCancelled.length === toCancel.length
            ? ` Credits were not returned (inside ${LATE_CANCEL_HOURS} hours of class).`
            : ` Credits returned for early cancels; classes inside ${LATE_CANCEL_HOURS} hours did not get credits back.`

    const message =
      mode === 'now'
        ? `Weekly series stopped. Cancelled ${result.cancelled_count} upcoming class${
            result.cancelled_count === 1 ? '' : 'es'
          }.${creditNote}`
        : `Weekly series will end after ${stopDate} (${timeZoneLabel}). Cancelled ${result.cancelled_count} later class${
            result.cancelled_count === 1 ? '' : 'es'
          }.${creditNote}`

    setSuccessBySeries((prev) => ({ ...prev, [seriesId]: message }))
    window.setTimeout(() => {
      setSuccessBySeries((prev) => {
        const next = { ...prev }
        delete next[seriesId]
        return next
      })
      void load()
      onChanged?.()
    }, 900)
  }

  if (loading && !hasLoadedOnceRef.current) {
    return (
      <div className="mt-8 border border-line bg-bg-elevated/60 p-6 text-sm text-ink-muted">
        Loading your upcoming classes…
      </div>
    )
  }

  if (!nextLesson && seriesBlocks.length === 0) {
    return null
  }

  return (
    <div className="mt-8 space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {nextLesson ? (
        <div className="border border-line bg-bg-elevated/60 p-6">
          <button
            type="button"
            onClick={() => openLesson(nextLesson)}
            disabled={!onSelectLesson}
            className={`w-full text-left ${onSelectLesson ? `${lessonButtonClass} cursor-pointer` : ''}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink-muted">Upcoming class</p>
            </div>
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
              {formatSlotRange(nextLesson.start_time, nextLesson.end_time, timeZone)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {formatDurationLabel(nextLesson.duration_minutes)}
              {nextLesson.series_id ? ' · Weekly series' : null}
            </p>
            {onSelectLesson ? (
              <p className="mt-2 text-xs font-medium text-sage-deep">Tap to cancel or reschedule</p>
            ) : null}
          </button>
          {nextLesson.meeting_url ? (
            <a
              href={nextLesson.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex bg-sage-deep px-4 py-2.5 text-sm font-semibold text-white hover:bg-sage"
            >
              Join class
            </a>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">Your tutor will add the join link soon.</p>
          )}
        </div>
      ) : (
        <div className="border border-line bg-bg-elevated/60 p-6">
          <p className="text-sm font-semibold text-ink-muted">Upcoming class</p>
          <p className="mt-2 text-ink-muted">No upcoming classes booked.</p>
        </div>
      )}

      {seriesBlocks.map(({ series: item, upcoming }) => {
        const success = successBySeries[item.id]
        const busy = busySeriesId === item.id
        const stopDate =
          stopDateBySeries[item.id] ?? todayDateInputValue(timeZone)
        const timeZoneLabel = formatTimezoneLabel(timeZone)
        const lateIfStopNow = lessonsCancelledByStop(upcoming, 'now', stopDate, timeZone).some(
          (lesson) => isLateCancel(lesson.start_time),
        )
        const lateIfStopOnDate = lessonsCancelledByStop(
          upcoming,
          'on_date',
          stopDate,
          timeZone,
        ).some((lesson) => isLateCancel(lesson.start_time))
        const hasLateCancel = lateIfStopNow || lateIfStopOnDate
        const stopPolicyAgreed = Boolean(stopPolicyAgreedBySeries[item.id])
        const stopPolicyShake = Boolean(stopPolicyShakeBySeries[item.id])

        return (
          <CollapsibleSection
            key={item.id}
            title="Weekly class"
            description={
              upcoming.length > 0
                ? `${formatDurationLabel(item.duration_minutes)} · ${upcoming.length} upcoming shown`
                : `${formatDurationLabel(item.duration_minutes)} · rolling weekly`
            }
            defaultOpen={false}
          >
            {success ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="confirm-btn-success flex h-14 w-14 items-center justify-center rounded-full bg-sage text-white">
                  <svg viewBox="0 0 20 20" fill="none" className="h-7 w-7" aria-hidden>
                    <path
                      d="M4 10.5 8 14.5 16 6.5"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="mt-4 font-display text-xl font-semibold">Done</p>
                <p className="mt-2 text-sm text-ink-muted">{success}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcoming.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    No upcoming classes in this series yet (rolling will add them when you open the
                    app).
                  </p>
                ) : (
                  <ul className="divide-y divide-line border border-line bg-white">
                    {upcoming.map((lesson) => (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => openLesson(lesson)}
                          disabled={!onSelectLesson}
                          className={`px-3 py-3 text-sm ${onSelectLesson ? `${lessonButtonClass} cursor-pointer` : 'w-full text-left'}`}
                        >
                          <p className="font-semibold text-ink">
                            {formatSlotRange(lesson.start_time, lesson.end_time, timeZone)}
                          </p>
                          <p className="mt-0.5 text-ink-muted">
                            {formatDurationLabel(lesson.duration_minutes)}
                          </p>
                        </button>
                        {lesson.meeting_url ? (
                          <a
                            href={lesson.meeting_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mx-3 mb-3 inline-flex border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg-elevated"
                          >
                            Join
                          </a>
                        ) : (
                          <p className="mx-3 mb-3 text-xs text-ink-muted">
                            Your tutor will add the join link soon.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-3 border-t border-line pt-4">
                  <p className="text-sm font-semibold">Stop weekly series</p>
                  <p className="text-xs text-ink-muted">
                    Stopping notifies your tutor. Stop now cancels every upcoming class in this
                    series. Stop on a date keeps classes through that calendar day in your
                    timezone ({timeZoneLabel}), matching the times shown on this page. Cancelled
                    classes follow the same {LATE_CANCEL_HOURS}-hour rule: early cancels return
                    credits; inside {LATE_CANCEL_HOURS} hours they do not.
                  </p>

                  {hasLateCancel ? (
                    <div
                      className={`border px-4 py-3 ${
                        stopPolicyShake
                          ? 'confirm-btn-shake border-red-400 bg-red-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <label className="flex items-start gap-3 text-sm text-red-950">
                        <input
                          type="checkbox"
                          checked={stopPolicyAgreed}
                          onChange={(event) =>
                            setStopPolicyAgreedBySeries((prev) => ({
                              ...prev,
                              [item.id]: event.target.checked,
                            }))
                          }
                          disabled={busy}
                          className="mt-1"
                        />
                        <span>
                          {LATE_CANCEL_AGREEMENT}
                          {lateIfStopNow && !lateIfStopOnDate ? (
                            <>
                              {' '}
                              Required for <strong>Stop now</strong>. Stop on date keeps your class
                              within {LATE_CANCEL_HOURS} hours, so that path does not need this.
                            </>
                          ) : null}
                        </span>
                      </label>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[10rem] flex-1">
                      <span className="text-xs font-semibold text-ink-muted">
                        Last day to keep ({timeZoneLabel})
                      </span>
                      <input
                        type="date"
                        value={stopDate}
                        min={todayDateInputValue(timeZone)}
                        onChange={(event) =>
                          setStopDateBySeries((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void stopSeries(item.id, 'on_date')}
                      className="border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
                    >
                      {busy ? 'Saving…' : 'Stop on date'}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void stopSeries(item.id, 'now')}
                    className="w-full border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Stop now (cancel all upcoming)'}
                  </button>
                </div>
              </div>
            )}
          </CollapsibleSection>
        )
      })}
    </div>
  )
}
