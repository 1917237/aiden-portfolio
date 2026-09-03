import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  type BookedRange,
  type ScheduleContext,
  getDurationOptionStates,
  validateLessonDuration,
} from '../../tutoring/bookingAvailabilityUtils'
import {
  formatDurationLabel,
  lessonCostCents,
  resolveBookingDuration,
  type BookingDurationMinutes,
} from '../../tutoring/bookingDurationConfig'
import { formatCredits, formatSlotRange } from '../../tutoring/format'
import {
  centsToLessonCredits,
  formatLessonCredits,
} from '../../tutoring/lessonCredits'
import {
  filterSlotsForLessonDuration,
  loadStudentOpenSlots,
} from '../../tutoring/loadStudentOpenSlots'
import type { AvailabilitySlot } from '../../tutoring/types'
import {
  addDaysToDateKey,
  formatWeekRangeFromKeys,
  getDateKeyInTimezone,
  getWeekDaysForTimezone,
  startOfWeekFromDateKey,
} from '../../tutoring/timezoneUtils'
import { formatBookingError } from '../../tutoring/bookingErrors'
import {
  buildSlotsByCell,
  buildTakenCellsByKey,
  StudentWhen2MeetGrid,
} from './StudentWhen2MeetGrid'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'
import { CancelClassDialog } from './CancelClassDialog'
import type { StudentLesson } from './StudentLessonsCalendar'

type Props = {
  lesson: StudentLesson
  timeZone: string
  classRateCents: number
  onClose: () => void
  onSaved: () => void
}

function isMissingRpc(message: string) {
  return (
    message.includes('Could not find the function') ||
    message.includes('does not exist') ||
    message.includes('PGRST202')
  )
}

export function StudentLessonModal({
  lesson,
  timeZone,
  classRateCents,
  onClose,
  onSaved,
}: Props) {
  const initialDuration = useMemo(
    () => resolveBookingDuration(lesson.duration_minutes),
    [lesson.duration_minutes],
  )
  const canEdit = lesson.status === 'booked' && new Date(lesson.start_time).getTime() > Date.now()

  const [weekStartKey, setWeekStartKey] = useState(() =>
    startOfWeekFromDateKey(getDateKeyInTimezone(new Date(lesson.start_time), timeZone)),
  )
  const [durationMinutes, setDurationMinutes] = useState<BookingDurationMinutes>(() =>
    resolveBookingDuration(lesson.duration_minutes),
  )
  const [rawOpenSlots, setRawOpenSlots] = useState<AvailabilitySlot[]>([])
  const [takenStartIsos, setTakenStartIsos] = useState<string[]>([])
  const [bookedRanges, setBookedRanges] = useState<BookedRange[]>([])
  const [schedule, setSchedule] = useState<ScheduleContext | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [loading, setLoading] = useState(canEdit)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [durationError, setDurationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)

  const weekDays = useMemo(
    () => getWeekDaysForTimezone(weekStartKey, timeZone),
    [weekStartKey, timeZone],
  )
  const weekEndKey = addDaysToDateKey(weekStartKey, 6)

  const load = useCallback(async () => {
    if (!canEdit) return
    if (!hasLoaded) setLoading(true)
    setError(null)

    try {
      const result = await loadStudentOpenSlots(timeZone, {
        excludeBookingStartIso: lesson.start_time,
      })

      setRawOpenSlots(result.allOpenSlots)
      setBookedRanges(result.bookedRanges)
      setSchedule(result.schedule)
      setTakenStartIsos(result.takenStartIsos)
      setHasLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load availability')
    } finally {
      setLoading(false)
    }
  }, [canEdit, hasLoaded, lesson.start_time, timeZone])

  useEffect(() => {
    setWeekStartKey(
      startOfWeekFromDateKey(getDateKeyInTimezone(new Date(lesson.start_time), timeZone)),
    )
    setDurationMinutes(resolveBookingDuration(lesson.duration_minutes))
    setSelectedSlot(null)
    setHasLoaded(false)
    setDurationError(null)
  }, [lesson.duration_minutes, lesson.id, lesson.start_time, timeZone])

  useEffect(() => {
    void load()
  }, [load])

  const filteredOpenSlots = useMemo(() => {
    if (!schedule) return []
    return filterSlotsForLessonDuration(
      rawOpenSlots,
      durationMinutes,
      schedule,
      bookedRanges,
      timeZone,
      rawOpenSlots,
    ).filter((slot) => slot.start_time !== lesson.start_time)
  }, [bookedRanges, durationMinutes, lesson.start_time, rawOpenSlots, schedule, timeZone])

  const weekSlots = useMemo(
    () =>
      filteredOpenSlots.filter((slot) => {
        const dateKey = getDateKeyInTimezone(slot.start_time, timeZone)
        return dateKey >= weekStartKey && dateKey <= weekEndKey
      }),
    [filteredOpenSlots, timeZone, weekEndKey, weekStartKey],
  )

  const slotsByCell = useMemo(() => buildSlotsByCell(weekSlots, timeZone), [weekSlots, timeZone])

  const takenCellsByKey = useMemo(() => {
    const weekTakenIsos = takenStartIsos.filter((iso) => {
      const dateKey = getDateKeyInTimezone(iso, timeZone)
      return dateKey >= weekStartKey && dateKey <= weekEndKey
    })
    return buildTakenCellsByKey(weekTakenIsos, timeZone)
  }, [takenStartIsos, timeZone, weekEndKey, weekStartKey])

  const resolvedStart = selectedSlot?.start_time ?? lesson.start_time

  const durationOptions = useMemo(
    () =>
      schedule
        ? getDurationOptionStates(resolvedStart, rawOpenSlots, bookedRanges)
        : [],
    [bookedRanges, rawOpenSlots, resolvedStart, schedule],
  )

  const canConfirmReschedule = useMemo(() => {
    if (!schedule || busy) return false

    const timeChanged = selectedSlot !== null && selectedSlot.start_time !== lesson.start_time
    const durationChanged = durationMinutes !== initialDuration
    if (!timeChanged && !durationChanged) return false

    const check = validateLessonDuration(
      resolvedStart,
      durationMinutes,
      schedule,
      bookedRanges,
      timeZone,
      rawOpenSlots,
    )
    return check.ok
  }, [
    bookedRanges,
    busy,
    durationMinutes,
    initialDuration,
    lesson.start_time,
    rawOpenSlots,
    resolvedStart,
    schedule,
    selectedSlot,
    timeZone,
  ])

  useEffect(() => {
    if (!schedule) return

    const check = validateLessonDuration(
      resolvedStart,
      durationMinutes,
      schedule,
      bookedRanges,
      timeZone,
      rawOpenSlots,
    )
    setDurationError(check.ok ? null : check.reason)

    if (!check.ok && selectedSlot) {
      setSelectedSlot(null)
    }
  }, [bookedRanges, durationMinutes, rawOpenSlots, resolvedStart, schedule, selectedSlot, timeZone])

  useEffect(() => {
    if (durationOptions.length === 0) return
    const selected = durationOptions.find((option) => option.minutes === durationMinutes)
    if (selected?.ok) return
    const firstOk = durationOptions.find((option) => option.ok)
    if (firstOk) setDurationMinutes(firstOk.minutes)
  }, [durationMinutes, durationOptions, resolvedStart])

  function finishSuccess(message: string) {
    setSuccessMessage(message)
    onSaved()
    window.setTimeout(() => onClose(), 900)
  }

  function shiftWeek(delta: number) {
    setSelectedSlot(null)
    setWeekStartKey((current) => addDaysToDateKey(current, delta * 7))
  }

  function goToLessonWeek() {
    setSelectedSlot(null)
    setWeekStartKey(
      startOfWeekFromDateKey(getDateKeyInTimezone(new Date(lesson.start_time), timeZone)),
    )
  }

  function selectDuration(minutes: BookingDurationMinutes) {
    setDurationMinutes(minutes)
    setSelectedSlot(null)
  }

  async function handleReschedule() {
    if (!canEdit || !canConfirmReschedule) return
    setBusy(true)
    setError(null)

    try {
      const { error: rpcError } = await supabase.rpc('student_reschedule_my_booking', {
        p_booking_id: lesson.id,
        p_new_start: resolvedStart,
        p_duration_minutes: durationMinutes,
      })

      if (rpcError) {
        if (isMissingRpc(rpcError.message)) {
          throw new Error(
            'Run supabase/36-student-reschedule-duration.sql in the Supabase SQL Editor, then try again.',
          )
        }
        throw rpcError
      }

      finishSuccess('Class rescheduled.')
    } catch (err) {
      setError(formatBookingError(err))
      setBusy(false)
    }
  }

  async function handleCancel(comment: string | null) {
    if (!canEdit) return

    setBusy(true)
    setError(null)

    try {
      const { error: rpcError } = await supabase.rpc('student_cancel_my_booking', {
        p_booking_id: lesson.id,
        p_comment: comment,
      })

      if (rpcError) {
        if (isMissingRpc(rpcError.message)) {
          throw new Error(
            'Run supabase/46-student-cancel-comment.sql in the Supabase SQL Editor, then try again.',
          )
        }
        throw rpcError
      }

      finishSuccess('Class cancelled.')
    } catch (err) {
      setError(formatBookingError(err))
      setBusy(false)
    }
  }

  const lessonEndIso = new Date(
    new Date(resolvedStart).getTime() + durationMinutes * 60_000,
  ).toISOString()

  const initialChargeCents = lessonCostCents(classRateCents, initialDuration)
  const newChargeCents = lessonCostCents(classRateCents, durationMinutes)
  const creditDeltaCents = newChargeCents - initialChargeCents
  const creditDeltaCredits = centsToLessonCredits(creditDeltaCents, classRateCents)
  const showCreditAdjustPreview =
    durationMinutes !== initialDuration && !durationError && creditDeltaCents !== 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-2xl font-semibold">
            {canEdit ? 'Reschedule class' : 'Your class'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-5">
          {successMessage ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
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
              <p className="mt-4 font-display text-2xl font-semibold">Done</p>
              <p className="mt-2 text-sm text-ink-muted">{successMessage}</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-ink-muted">Currently scheduled</p>
                <p className="mt-1 font-display text-xl font-semibold">
                  {formatSlotRange(lesson.start_time, lesson.end_time, timeZone)}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {formatDurationLabel(initialDuration)}
                  {lesson.pay_later ? ' · pay later' : ''}
                  {lesson.status === 'completed' ? ' · completed' : null}
                </p>
              </div>

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              {!canEdit ? (
                <p className="text-sm text-ink-muted">
                  Past or completed classes can’t be changed here.
                </p>
              ) : (
                <>
                  <div className="border border-sage/30 bg-sage/10 px-4 py-3 text-sm text-ink">
                    <p className="font-semibold">Pick a new time</p>
                    <p className="mt-1 text-ink-muted">
                      Green cells are open, amber cells are taken by another student. Click a green
                      cell, adjust lesson length below if needed, then confirm. Your tutor will be
                      notified.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => shiftWeek(-1)}
                      className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
                      aria-label="Previous week"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={goToLessonWeek}
                      className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
                    >
                      This class
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftWeek(1)}
                      className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
                      aria-label="Next week"
                    >
                      →
                    </button>
                    <span className="ml-1 font-semibold">
                      {formatWeekRangeFromKeys(weekStartKey, timeZone)}
                    </span>
                    <TimesInTimezoneLabel timeZone={timeZone} className="ml-auto" />
                  </div>

                  {loading && !hasLoaded ? (
                    <p className="text-ink-muted">Loading availability…</p>
                  ) : (
                    <StudentWhen2MeetGrid
                      weekDays={weekDays}
                      slotsByCell={slotsByCell}
                      takenCellsByKey={takenCellsByKey}
                      timeZone={timeZone}
                      selectedSlotId={selectedSlot?.id ?? null}
                      onSelectSlot={setSelectedSlot}
                      mode="reschedule"
                    />
                  )}

                  {hasLoaded && !loading && weekSlots.length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      No open times this week for a {formatDurationLabel(durationMinutes)} lesson.
                      Try another week or a shorter length.
                    </p>
                  ) : null}

                  {(selectedSlot || durationMinutes !== initialDuration) && !durationError ? (
                    <p className="text-sm font-semibold text-sage-deep">
                      New time: {formatSlotRange(resolvedStart, lessonEndIso, timeZone)}
                      {' · '}
                      {formatDurationLabel(durationMinutes)}
                    </p>
                  ) : null}

                  <div className="border-t border-line pt-4">
                    <p className="text-sm font-semibold text-ink-muted">Lesson length</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {durationOptions.map((option) => {
                        const selected = durationMinutes === option.minutes
                        const disabled = !option.ok
                        return (
                          <button
                            key={option.minutes}
                            type="button"
                            disabled={disabled}
                            title={disabled ? option.reason : undefined}
                            onClick={() => selectDuration(option.minutes)}
                            className={`border px-3 py-2.5 text-sm font-semibold transition-colors ${
                              disabled
                                ? 'cursor-not-allowed border-line bg-bg-elevated/60 text-ink-muted/50'
                                : selected
                                  ? 'border-sage-deep bg-sage/15 text-ink'
                                  : 'border-line hover:bg-bg-elevated'
                            }`}
                          >
                            {formatDurationLabel(option.minutes)}
                          </button>
                        )
                      })}
                    </div>
                    {durationError ? (
                      <p className="mt-3 text-sm text-red-700" role="alert">
                        {durationError}
                      </p>
                    ) : showCreditAdjustPreview ? (
                      <p className="mt-3 text-sm text-ink">
                        {creditDeltaCents > 0 ? (
                          <>
                            <span className="font-semibold text-red-700">
                              +{formatLessonCredits(creditDeltaCredits)} more reserved
                            </span>
                            <span className="text-ink-muted">
                              {' '}
                              ({formatCredits(creditDeltaCents)} added to this lesson&apos;s hold)
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-green-700">
                              {formatLessonCredits(creditDeltaCredits)} returned
                            </span>
                            <span className="text-ink-muted">
                              {' '}
                              ({formatCredits(Math.abs(creditDeltaCents))} back to your balance)
                            </span>
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">
                        Change length only (same time) or pick a green cell for a new time.
                        Credits adjust if the length changes.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !canConfirmReschedule}
                      onClick={() => void handleReschedule()}
                      className="flex-1 bg-sage-deep px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {busy ? 'Saving…' : 'Confirm changes'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCancelDialogOpen(true)}
                      className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-60"
                    >
                      {busy ? 'Cancelling…' : 'Cancel class'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <CancelClassDialog
        open={cancelDialogOpen}
        variant="student"
        busy={busy}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={(comment) => {
          setCancelDialogOpen(false)
          void handleCancel(comment)
        }}
      />
    </div>
  )
}
