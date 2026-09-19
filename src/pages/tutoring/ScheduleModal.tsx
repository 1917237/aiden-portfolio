import { type ReactNode, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cancelBooking, removeBlockoutsByIds, removeDateAvailabilitySlots, rescheduleBookingToTime } from '../../tutoring/bookingActions'
import type { CalendarBooking } from '../../tutoring/calendarDayEvents'
import { TUTOR_SCHEDULE_TIMEZONE } from '../../tutoring/config'
import {
  SLOT_INTERVAL_MINUTES,
  formatTimeLabel,
} from '../../tutoring/scheduleConfig'
import { formatCredits } from '../../tutoring/format'
import { formatBookingError } from '../../tutoring/bookingErrors'
import {
  BOOKING_DURATION_OPTIONS,
  formatDurationLabel,
  lessonCostCents,
  occupiedMinutesForDuration,
  resolveBookingDuration,
  type BookingDurationMinutes,
} from '../../tutoring/bookingDurationConfig'
import { regenerateBookableSlots } from '../../tutoring/regenerateSlots'
import { findContiguousExtra } from '../../tutoring/extraAvailabilityUtils'
import { findContiguousBlock } from '../../tutoring/blockoutScheduleUtils'
import { DATE_AVAILABILITY_SETUP, isMissingTableError } from '../../tutoring/supabaseErrors'
import {
  HOURS_12,
  MINUTES_15,
  slotEndMinutes,
  to12HourParts,
  to24Hour,
} from '../../tutoring/scheduleModalUtils'
import {
  displayToTutorCivil,
  each15MinSlotMapped,
  mapAllDayDatesToTutor,
  zonedRangeToIso,
} from '../../tutoring/scheduleTimezoneMap'
import type { Blockout, DateAvailability } from '../../tutoring/scheduleTypes'
import type { StudentProfile } from '../../tutoring/types'
import { CreditBalance } from './CreditBalance'
import { CancelClassDialog } from './CancelClassDialog'
import type { WeekCellState } from '../../tutoring/weekCalendarUtils'

type Tab = 'lesson' | 'join' | 'timeoff' | 'extra'

type SlotSelection = {
  dateKey: string
  startMinutes: number
  cellState: WeekCellState
}

type Props = {
  selection: SlotSelection
  students: StudentProfile[]
  blockouts: Blockout[]
  dateExtras: DateAvailability[]
  booking?: CalendarBooking | null
  timeZone: string
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}

function defaultTab(state: WeekCellState, hasBooking: boolean): Tab {
  if (hasBooking) return 'lesson'
  if (state === 'extra') return 'extra'
  if (state === 'unavailable') return 'extra'
  if (state === 'blocked') return 'timeoff'
  return 'lesson'
}

export function ScheduleModal({
  selection,
  students,
  blockouts,
  dateExtras,
  booking,
  timeZone,
  onClose,
  onSaved,
  onError,
}: Props) {
  const initial = to12HourParts(selection.startMinutes)
  const endMin = slotEndMinutes(selection.startMinutes)
  const extraEndMin = selection.startMinutes + SLOT_INTERVAL_MINUTES

  const tutorSelection = displayToTutorCivil(
    selection.dateKey,
    selection.startMinutes,
    timeZone,
    TUTOR_SCHEDULE_TIMEZONE,
  )

  const [tab, setTab] = useState<Tab>(() => defaultTab(selection.cellState, Boolean(booking)))
  const [busy, setBusy] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [meetingUrlDraft, setMeetingUrlDraft] = useState(booking?.meeting_url ?? '')
  const [applySeriesLink, setApplySeriesLink] = useState(Boolean(booking?.series_id))
  const [joinSaveSuccess, setJoinSaveSuccess] = useState(false)

  const [studentId, setStudentId] = useState(booking?.student_id ?? '')
  const [lessonDate, setLessonDate] = useState(selection.dateKey)
  const [lessonHour, setLessonHour] = useState(initial.hour12)
  const [lessonMinute, setLessonMinute] = useState(initial.minute)
  const [lessonPeriod, setLessonPeriod] = useState<'AM' | 'PM'>(initial.period)
  const [durationMinutes, setDurationMinutes] = useState<BookingDurationMinutes>(() =>
    resolveBookingDuration(booking?.duration_minutes),
  )

  const [allDay, setAllDay] = useState(false)
  const [offStartDate, setOffStartDate] = useState(selection.dateKey)
  const [offStartHour, setOffStartHour] = useState(initial.hour12)
  const [offStartMinute, setOffStartMinute] = useState(initial.minute)
  const [offStartPeriod, setOffStartPeriod] = useState<'AM' | 'PM'>(initial.period)
  const [offEndDate, setOffEndDate] = useState(selection.dateKey)
  const [offEndHour, setOffEndHour] = useState(to12HourParts(endMin).hour12)
  const [offEndMinute, setOffEndMinute] = useState(to12HourParts(endMin).minute)
  const [offEndPeriod, setOffEndPeriod] = useState<'AM' | 'PM'>(to12HourParts(endMin).period)

  const [extraStartDate, setExtraStartDate] = useState(selection.dateKey)
  const [extraStartHour, setExtraStartHour] = useState(initial.hour12)
  const [extraStartMinute, setExtraStartMinute] = useState(initial.minute)
  const [extraStartPeriod, setExtraStartPeriod] = useState<'AM' | 'PM'>(initial.period)
  const [extraEndDate, setExtraEndDate] = useState(selection.dateKey)
  const [extraEndHour, setExtraEndHour] = useState(to12HourParts(extraEndMin).hour12)
  const [extraEndMinute, setExtraEndMinute] = useState(to12HourParts(extraEndMin).minute)
  const [extraEndPeriod, setExtraEndPeriod] = useState<'AM' | 'PM'>(to12HourParts(extraEndMin).period)

  const activeBlock = findContiguousBlock(
    tutorSelection.dateKey,
    tutorSelection.startMinutes,
    blockouts,
  )
  const activeExtra = findContiguousExtra(
    tutorSelection.dateKey,
    tutorSelection.startMinutes,
    dateExtras,
  )

  const selectedStudent = students.find((s) => s.id === studentId)
  const scheduleCreditChargeCents = selectedStudent
    ? lessonCostCents(selectedStudent.class_rate_cents, durationMinutes)
    : 0

  useEffect(() => {
    if (booking) {
      setStudentId(booking.student_id)
      setDurationMinutes(resolveBookingDuration(booking.duration_minutes))
      setMeetingUrlDraft(booking.meeting_url ?? '')
      setApplySeriesLink(Boolean(booking.series_id))
      setJoinSaveSuccess(false)
      setTab('lesson')
    }
  }, [booking])

  function finishSuccess(nextMessage: string) {
    setBusy(false)
    setLocalError(null)
    setSuccessMessage(nextMessage)
    onSaved()
    window.setTimeout(() => {
      onClose()
    }, 600)
  }

  function reportError(message: string) {
    setLocalError(message)
    onError(message)
    setBusy(false)
  }

  function partsToMinutes(hour12: number, minute: number, period: 'AM' | 'PM') {
    return to24Hour(hour12, period) * 60 + minute
  }

  async function ensureSlotAndBook(
    startIso: string,
    endIso: string,
    targetStudentId: string,
    lessonDurationMinutes: BookingDurationMinutes,
  ) {
    const { data: existing } = await supabase
      .from('availability_slots')
      .select('id, is_booked')
      .eq('start_time', startIso)
      .maybeSingle()

    let slotId = existing?.id as string | undefined

    if (existing?.is_booked) {
      throw new Error('That time is already booked.')
    }

    if (!slotId) {
      const { data, error } = await supabase
        .from('availability_slots')
        .insert({ start_time: startIso, end_time: endIso, is_booked: false })
        .select('id')
        .single()
      if (error) throw error
      slotId = data.id as string
    }

    const { error: bookError } = await supabase.rpc('admin_book_slot', {
      p_student_id: targetStudentId,
      p_slot_id: slotId,
      p_duration_minutes: lessonDurationMinutes,
    })

    if (bookError) {
      if (bookError.message.includes('Could not find the function')) {
        throw new Error(
          'Run supabase/42-admin-book-duration.sql in the Supabase SQL Editor first.',
        )
      }
      throw bookError
    }
  }

  async function handleScheduleLesson() {
    if (!studentId) {
      reportError('Pick a student.')
      return
    }

    const startMinutes = partsToMinutes(lessonHour, lessonMinute, lessonPeriod)
    const occupyMinutes = occupiedMinutesForDuration(durationMinutes)
    const endMinutes = startMinutes + occupyMinutes
    const { startIso, endIso } = zonedRangeToIso(
      lessonDate,
      startMinutes,
      lessonDate,
      endMinutes,
      timeZone,
    )
    const tutor = displayToTutorCivil(lessonDate, startMinutes, timeZone, TUTOR_SCHEDULE_TIMEZONE)

    setBusy(true)
    setLocalError(null)
    onError('')
    setSuccessMessage(null)

    try {
      if (booking) {
        await rescheduleBookingToTime(
          booking.id,
          tutor.dateKey,
          tutor.startMinutes,
          startIso,
          endIso,
          blockouts,
          durationMinutes,
        )
        finishSuccess('Lesson rescheduled.')
      } else {
        await ensureSlotAndBook(startIso, endIso, studentId, durationMinutes)
        finishSuccess('Lesson scheduled.')
      }
    } catch (err) {
      reportError(formatBookingError(err))
    }
  }

  async function handleCancelLesson(comment: string | null) {
    if (!booking) return

    setBusy(true)
    setLocalError(null)
    onError('')
    try {
      await cancelBooking(booking.id, comment)
      finishSuccess('Class cancelled.')
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  async function handleSaveJoinLink() {
    if (!booking) return
    const url = meetingUrlDraft.trim()
    if (!url) {
      setLocalError('Paste a join link first.')
      return
    }

    setBusy(true)
    setLocalError(null)
    onError('')
    setJoinSaveSuccess(false)

    try {
      if (booking.series_id && applySeriesLink) {
        const { error: seriesError } = await supabase.rpc('admin_set_series_meeting_url', {
          p_series_id: booking.series_id,
          p_url: url,
        })
        if (seriesError) throw seriesError
      } else {
        const { error: rpcError } = await supabase.rpc('admin_set_booking_meeting_url', {
          p_booking_id: booking.id,
          p_url: url,
        })
        if (rpcError) throw rpcError
      }
      setBusy(false)
      setJoinSaveSuccess(true)
      onSaved()
      window.setTimeout(() => {
        setJoinSaveSuccess(false)
      }, 900)
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to save join link')
    }
  }

  async function handleCancelTimeOff() {
    if (!activeBlock) return
    if (!window.confirm('Cancel this time off?')) return

    setBusy(true)
    setLocalError(null)
    onError('')
    setSuccessMessage(null)

    try {
      await removeBlockoutsByIds(activeBlock.ids)
      finishSuccess('Time off cancelled.')
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to cancel time off')
    }
  }

  async function handleTimeOff() {
    setBusy(true)
    setLocalError(null)
    onError('')
    setSuccessMessage(null)

    try {
      if (allDay) {
        const days = mapAllDayDatesToTutor(offStartDate, offEndDate, timeZone, TUTOR_SCHEDULE_TIMEZONE)
        const rows = days.map((dateKey) => ({ blockout_date: dateKey, start_minutes: null }))
        const { error } = await supabase.from('availability_blockouts').insert(rows)
        if (error) throw error
      } else {
        const startMinutes = partsToMinutes(offStartHour, offStartMinute, offStartPeriod)
        const endMinutes = partsToMinutes(offEndHour, offEndMinute, offEndPeriod)
        const slots = each15MinSlotMapped(
          offStartDate,
          startMinutes,
          offEndDate,
          endMinutes,
          timeZone,
          TUTOR_SCHEDULE_TIMEZONE,
        )
        if (slots.length === 0) throw new Error('End time must be after start time.')
        const rows = slots.map((s) => ({ blockout_date: s.dateKey, start_minutes: s.startMinutes }))
        const { error } = await supabase.from('availability_blockouts').insert(rows)
        if (error) throw error
      }

      await regenerateBookableSlots()
      finishSuccess('Time off booked.')
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to book time off')
    }
  }

  async function handleCancelExtra() {
    if (!activeExtra) return
    if (!window.confirm('Remove this extra availability?')) return

    setBusy(true)
    setLocalError(null)
    onError('')
    setSuccessMessage(null)

    try {
      await removeDateAvailabilitySlots(activeExtra.slots)
      finishSuccess('Extra availability removed.')
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to remove extra availability')
    }
  }

  async function handleExtraSlots() {
    setBusy(true)
    setLocalError(null)
    onError('')
    setSuccessMessage(null)

    try {
      const startMinutes = partsToMinutes(extraStartHour, extraStartMinute, extraStartPeriod)
      const endMinutes = partsToMinutes(extraEndHour, extraEndMinute, extraEndPeriod)
      const slots = each15MinSlotMapped(
        extraStartDate,
        startMinutes,
        extraEndDate,
        endMinutes,
        timeZone,
        TUTOR_SCHEDULE_TIMEZONE,
      )
      if (slots.length === 0) throw new Error('End time must be after start time.')

      const rows = slots.map((s) => ({
        availability_date: s.dateKey,
        start_minutes: s.startMinutes,
      }))

      const { error } = await supabase.from('date_availability').insert(rows)
      if (error) {
        if (isMissingTableError(error.message, 'date_availability')) {
          throw new Error(DATE_AVAILABILITY_SETUP)
        }
        throw error
      }

      await regenerateBookableSlots()
      finishSuccess('Extra slots added.')
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to add extra slots')
    }
  }

  const tabs: { id: Tab; label: string }[] = booking
    ? [
        { id: 'lesson', label: 'Lesson' },
        { id: 'join', label: 'Join link' },
        { id: 'timeoff', label: 'Time off' },
        { id: 'extra', label: 'Extra slots' },
      ]
    : [
        { id: 'lesson', label: 'Lesson' },
        { id: 'timeoff', label: 'Time off' },
        { id: 'extra', label: 'Extra slots' },
      ]

  return (
    <div className="tutoring-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="tutoring-modal-panel max-h-[92vh] w-full max-w-md overflow-y-auto border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-2xl font-semibold">Schedule</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!successMessage ? (
          <div className="flex border-b border-line px-5">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-3 text-sm font-semibold ${
                  tab === item.id
                    ? 'border-b-2 border-sage-deep text-ink'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

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
          ) : null}

          {!successMessage ? (
            <>
          {localError ? (
            <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{localError}</p>
          ) : null}

          {activeExtra && tab !== 'extra' && !booking ? (
            <div className="border border-sky-200 bg-sky-50 p-3">
              <p className="text-sm font-semibold text-sky-900">
                Extra availability{' '}
                {formatTimeLabel(activeExtra.startMinutes)} to {formatTimeLabel(activeExtra.endMinutes)}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCancelExtra()}
                className="mt-2 w-full border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Remove extra availability'}
              </button>
            </div>
          ) : null}

          {activeBlock && tab !== 'timeoff' && !activeExtra ? (
            <div className="border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">
                {activeBlock.kind === 'whole-day'
                  ? 'All day is blocked'
                  : `Blocked ${formatTimeLabel(activeBlock.startMinutes)} to ${formatTimeLabel(activeBlock.endMinutes)}`}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCancelTimeOff()}
                className="mt-2 w-full border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Cancel time off'}
              </button>
            </div>
          ) : null}

          {tab === 'lesson' ? (
            <>
              {booking ? (
                <p className="text-sm text-ink-muted">
                  Editing: <strong>{booking.student_name}</strong> ·{' '}
                  {formatTimeLabel(partsToMinutes(lessonHour, lessonMinute, lessonPeriod))}
                </p>
              ) : null}

              <label className="block">
                <span className="text-sm font-semibold">Student</span>
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={Boolean(booking)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 disabled:opacity-70"
                >
                  <option value="">Add student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({formatCredits(s.class_rate_cents)}/class)
                    </option>
                  ))}
                </select>
              </label>

              {selectedStudent && !booking ? (
                <p className="text-sm text-ink-muted">
                  Balance: <CreditBalance cents={selectedStudent.credit_balance_cents} />
                  {' · '}
                  Scheduling reserves {formatCredits(scheduleCreditChargeCents)} for a{' '}
                  {formatDurationLabel(durationMinutes)} lesson (balance may go negative).
                </p>
              ) : null}

              <div>
                <p className="text-sm font-semibold text-ink-muted">Lesson length</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BOOKING_DURATION_OPTIONS.map((minutes) => {
                    const selected = durationMinutes === minutes
                    return (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => setDurationMinutes(minutes)}
                        className={`border px-3 py-2.5 text-sm font-semibold transition-colors ${
                          selected
                            ? 'border-sage-deep bg-sage/15 text-ink'
                            : 'border-line hover:bg-bg-elevated'
                        }`}
                      >
                        {formatDurationLabel(minutes)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <span className="text-sm font-semibold">Date and time</span>
                <p className="mt-1 text-xs text-ink-muted">
                  {formatDurationLabel(durationMinutes)} lesson
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <DateInput value={lessonDate} onChange={setLessonDate} />
                  <TimeInput
                    hour={lessonHour}
                    minute={lessonMinute}
                    period={lessonPeriod}
                    onHour={setLessonHour}
                    onMinute={setLessonMinute}
                    onPeriod={setLessonPeriod}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleScheduleLesson()}
                  className="flex-1 bg-sage-deep px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? 'Saving…' : booking ? 'Save lesson' : 'Schedule lesson'}
                </button>
                {booking ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCancelDialogOpen(true)}
                    className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-60"
                  >
                    {busy ? 'Cancelling…' : 'Cancel class'}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === 'join' && booking ? (
            <>
              <p className="text-sm text-ink-muted">
                Join link for <strong>{booking.student_name}</strong>. Students see this on their
                upcoming class and lesson details.
              </p>
              <label className="block">
                <span className="text-sm font-semibold">Meeting URL</span>
                <input
                  type="url"
                  value={meetingUrlDraft}
                  onChange={(event) => setMeetingUrlDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSaveJoinLink()
                    }
                  }}
                  disabled={busy || joinSaveSuccess}
                  placeholder="https://…"
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
                />
              </label>
              {booking.series_id ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={applySeriesLink}
                    onChange={(event) => setApplySeriesLink(event.target.checked)}
                    disabled={busy || joinSaveSuccess}
                  />
                  Apply to the whole weekly series
                </label>
              ) : null}
              <button
                type="button"
                disabled={busy || joinSaveSuccess}
                onClick={() => void handleSaveJoinLink()}
                className={`inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-100 ${
                  joinSaveSuccess
                    ? 'confirm-btn-success bg-sage text-white'
                    : 'bg-sage-deep text-white'
                }`}
              >
                {busy ? (
                  <span className="text-xs tracking-wide">Saving…</span>
                ) : joinSaveSuccess ? (
                  <>
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
                      <path
                        d="M4 10.5 8 14.5 16 6.5"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Saved</span>
                  </>
                ) : (
                  <span>Save join link</span>
                )}
              </button>
            </>
          ) : null}

          {tab === 'timeoff' ? (
            <>
              {activeBlock ? (
                <div className="border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-semibold text-red-900">
                    {activeBlock.kind === 'whole-day'
                      ? 'All day is blocked'
                      : `Blocked ${formatTimeLabel(activeBlock.startMinutes)} to ${formatTimeLabel(activeBlock.endMinutes)}`}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancelTimeOff()}
                    className="mt-2 w-full border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Cancel time off'}
                  </button>
                </div>
              ) : null}

              <p className="text-sm text-ink-muted">Block time so students cannot book it.</p>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
                All day
              </label>

              {allDay ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Starts">
                    <DateInput value={offStartDate} onChange={setOffStartDate} />
                  </Field>
                  <Field label="Ends">
                    <DateInput value={offEndDate} onChange={setOffEndDate} />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Starts">
                    <div className="grid grid-cols-2 gap-2">
                      <DateInput value={offStartDate} onChange={setOffStartDate} />
                      <TimeInput
                        hour={offStartHour}
                        minute={offStartMinute}
                        period={offStartPeriod}
                        onHour={setOffStartHour}
                        onMinute={setOffStartMinute}
                        onPeriod={setOffStartPeriod}
                      />
                    </div>
                  </Field>
                  <Field label="Ends">
                    <div className="grid grid-cols-2 gap-2">
                      <DateInput value={offEndDate} onChange={setOffEndDate} />
                      <TimeInput
                        hour={offEndHour}
                        minute={offEndMinute}
                        period={offEndPeriod}
                        onHour={setOffEndHour}
                        onMinute={setOffEndMinute}
                        onPeriod={setOffEndPeriod}
                      />
                    </div>
                  </Field>
                </>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTimeOff()}
                className="w-full bg-sage-deep px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Book time off'}
              </button>
            </>
          ) : null}

          {tab === 'extra' ? (
            <>
              {activeExtra ? (
                <div className="border border-sky-200 bg-sky-50 p-3">
                  <p className="text-sm font-semibold text-sky-900">
                    Extra availability{' '}
                    {formatTimeLabel(activeExtra.startMinutes)} to {formatTimeLabel(activeExtra.endMinutes)}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancelExtra()}
                    className="mt-2 w-full border border-sky-300 bg-white px-3 py-2 text-sm font-semibold text-sky-900 disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Remove extra availability'}
                  </button>
                </div>
              ) : null}

              <div>
                <p className="font-semibold">Add extra slots</p>
                <p className="text-sm text-ink-muted">
                  Opens this time for student booking, even if it overlaps with time off. Other
                  blocked times stay blocked.
                </p>
              </div>

              <Field label="Starts">
                <div className="grid grid-cols-2 gap-2">
                  <DateInput value={extraStartDate} onChange={setExtraStartDate} />
                  <TimeInput
                    hour={extraStartHour}
                    minute={extraStartMinute}
                    period={extraStartPeriod}
                    onHour={setExtraStartHour}
                    onMinute={setExtraStartMinute}
                    onPeriod={setExtraStartPeriod}
                  />
                </div>
              </Field>
              <Field label="Ends">
                <div className="grid grid-cols-2 gap-2">
                  <DateInput value={extraEndDate} onChange={setExtraEndDate} />
                  <TimeInput
                    hour={extraEndHour}
                    minute={extraEndMinute}
                    period={extraEndPeriod}
                    onHour={setExtraEndHour}
                    onMinute={setExtraEndMinute}
                    onPeriod={setExtraEndPeriod}
                  />
                </div>
              </Field>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExtraSlots()}
                className="w-full bg-sage-deep px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Add extra slots'}
              </button>
            </>
          ) : null}
            </>
          ) : null}
        </div>
      </div>

      <CancelClassDialog
        open={cancelDialogOpen}
        variant="admin"
        busy={busy}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={({ comment }) => {
          setCancelDialogOpen(false)
          void handleCancelLesson(comment)
        }}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-line bg-white px-3 py-2.5 text-sm"
    />
  )
}

type TimeInputProps = {
  hour: number
  minute: number
  period: 'AM' | 'PM'
  onHour: (v: number) => void
  onMinute: (v: number) => void
  onPeriod: (v: 'AM' | 'PM') => void
}

function TimeInput({ hour, minute, period, onHour, onMinute, onPeriod }: TimeInputProps) {
  return (
    <div className="flex gap-1">
      <select
        value={hour}
        onChange={(e) => onHour(Number(e.target.value))}
        className="min-w-0 flex-1 border border-line bg-white px-1 py-2.5 text-sm"
      >
        {HOURS_12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => onMinute(Number(e.target.value))}
        className="w-14 border border-line bg-white px-1 py-2.5 text-sm"
      >
        {MINUTES_15.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
      <select
        value={period}
        onChange={(e) => onPeriod(e.target.value as 'AM' | 'PM')}
        className="w-14 border border-line bg-white px-1 py-2.5 text-sm"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
