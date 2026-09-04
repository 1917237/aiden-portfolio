import { useEffect, useMemo, useState } from 'react'
import { isoToZonedParts } from '../../tutoring/timezoneUtils'
import {
  type BookedRange,
  type ScheduleContext,
  type WeeklyWeekStatus,
  getDurationOptionStates,
  validateLessonDuration,
  validateWeeklyLesson,
} from '../../tutoring/bookingAvailabilityUtils'
import {
  DEFAULT_BOOKING_DURATION_MINUTES,
  formatDurationLabel,
  lessonCostCents,
  WEEKLY_LESSON_COUNT,
  type BookingDurationMinutes,
} from '../../tutoring/bookingDurationConfig'
import { formatCredits } from '../../tutoring/format'
import {
  centsToLessonCredits,
  formatLessonCredits,
  lessonCreditsForDuration,
} from '../../tutoring/lessonCredits'
import {
  ensureOpenSlotForDuration,
  isVirtualSlot,
} from '../../tutoring/studentScheduleAvailability'
import type { AvailabilitySlot } from '../../tutoring/types'
import { supabase } from '../../lib/supabase'
import { formatBookingError } from '../../tutoring/bookingErrors'
import { STUDENT_PAY_LATER_HINT } from '../../tutoring/studentCreditCopy'
import { LATE_CANCEL_AGREEMENT } from '../../tutoring/lateCancelPolicy'

type Props = {
  slot: AvailabilitySlot
  creditBalance: number
  classRateCents: number
  openSlots: AvailabilitySlot[]
  occupiedTimes: Set<string>
  bookedRanges: BookedRange[]
  timeZone: string
  onClose: () => void
  onBooked: () => void
}

type ConfirmState = 'idle' | 'loading' | 'success' | 'error'

function formatSlotHeading(iso: string, timeZone: string) {
  const { hour12, minute, period } = isoToZonedParts(iso, timeZone)
  const date = new Date(iso)
  const weekday = date.toLocaleDateString('en-US', { timeZone, weekday: 'long' })
  const monthDay = date.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
  const time =
    minute === 0
      ? `${hour12} ${period}`
      : `${hour12}:${String(minute).padStart(2, '0')} ${period}`
  return { weekday, monthDay, time }
}

function shortUnavailableReason(reason?: string) {
  if (!reason) return 'Unavailable'
  if (reason === 'Already booked' || reason === 'Not open') return reason
  if (reason.includes('already scheduled')) return 'Conflict'
  if (reason.includes('availability ends')) return 'Too short'
  return 'Unavailable'
}

export function StudentBookingModal({
  slot,
  creditBalance,
  classRateCents,
  openSlots,
  occupiedTimes,
  bookedRanges,
  timeZone,
  onClose,
  onBooked,
}: Props) {
  const [durationMinutes, setDurationMinutes] =
    useState<BookingDurationMinutes>(DEFAULT_BOOKING_DURATION_MINUTES)
  const [weekly, setWeekly] = useState(false)
  const [scheduleAnyway, setScheduleAnyway] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleContext | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [durationError, setDurationError] = useState<string | null>(null)
  const [unavailableWeeks, setUnavailableWeeks] = useState<WeeklyWeekStatus[]>([])
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([])
  const [availableLessonCount, setAvailableLessonCount] = useState(WEEKLY_LESSON_COUNT)
  const [bookedLessonCount, setBookedLessonCount] = useState(1)
  const [shake, setShake] = useState(false)
  const [shakePolicy, setShakePolicy] = useState(false)
  const [policyAgreed, setPolicyAgreed] = useState(false)
  const [confirmState, setConfirmState] = useState<ConfirmState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const heading = useMemo(() => formatSlotHeading(slot.start_time, timeZone), [slot.start_time, timeZone])

  const durationOptions = useMemo(
    () => getDurationOptionStates(slot.start_time, openSlots, bookedRanges),
    [bookedRanges, openSlots, slot.start_time],
  )

  const allowedDurations = useMemo(
    () => durationOptions.filter((option) => option.ok).map((option) => option.minutes),
    [durationOptions],
  )

  useEffect(() => {
    if (allowedDurations.length === 0) return
    if (!allowedDurations.includes(durationMinutes)) {
      setDurationMinutes(allowedDurations[0])
    }
  }, [allowedDurations, durationMinutes, slot.id])

  useEffect(() => {
    let cancelled = false

    async function loadSchedule() {
      const [weeklyResult, blockoutResult, dateExtraResult] = await Promise.all([
        supabase.from('weekly_availability').select('day_of_week, start_minutes'),
        supabase.from('availability_blockouts').select('blockout_date, start_minutes'),
        supabase.from('date_availability').select('availability_date, start_minutes'),
      ])

      if (cancelled) return

      if (weeklyResult.error || blockoutResult.error || dateExtraResult.error) {
        setScheduleError(
          weeklyResult.error?.message ??
            blockoutResult.error?.message ??
            dateExtraResult.error?.message ??
            'Could not load availability',
        )
        return
      }

      setSchedule({
        weeklyCells: weeklyResult.data ?? [],
        blockouts: blockoutResult.data ?? [],
        dateExtras: dateExtraResult.data ?? [],
      })
    }

    void loadSchedule()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setScheduleAnyway(false)
  }, [weekly, durationMinutes, slot.id])

  const lessonCount = weekly ? availableLessonCount : 1
  const perLessonCost = lessonCostCents(classRateCents, durationMinutes)
  const totalCost = perLessonCost * Math.max(lessonCount, 0)
  const perLessonCredits = lessonCreditsForDuration(durationMinutes)
  const totalLessonCredits = perLessonCredits * Math.max(lessonCount, 0)
  const balanceCredits = centsToLessonCredits(creditBalance, classRateCents)
  const hasEnoughCredits = creditBalance >= totalCost
  const hasPartialWeeks = weekly && unavailableWeeks.length > 0 && availableLessonCount > 0
  const canConfirm =
    !durationError &&
    (!hasPartialWeeks || scheduleAnyway) &&
    availableLessonCount > 0

  useEffect(() => {
    if (!schedule) return

    if (!weekly) {
      const result = validateLessonDuration(
        slot.start_time,
        durationMinutes,
        schedule,
        bookedRanges,
        timeZone,
        openSlots,
      )
      setDurationError(result.ok ? null : result.reason)
      setUnavailableWeeks([])
      setAvailableSlots(result.ok ? [slot] : [])
      setAvailableLessonCount(result.ok ? 1 : 0)
      return
    }

    const result = validateWeeklyLesson(
      slot,
      durationMinutes,
      schedule,
      bookedRanges,
      openSlots,
      occupiedTimes,
      timeZone,
    )

    setUnavailableWeeks(result.unavailableWeeks)
    setAvailableSlots(result.ok ? result.slots : [])
    setAvailableLessonCount(result.ok ? result.slots.length : 0)

    if (!result.ok) {
      setDurationError(result.reason)
      return
    }

    // Partial weeks are a warning, not a hard block — user can schedule anyway
    setDurationError(null)
  }, [
    bookedRanges,
    durationMinutes,
    occupiedTimes,
    openSlots,
    schedule,
    slot,
    timeZone,
    weekly,
  ])

  function triggerShake() {
    setShake(true)
    window.setTimeout(() => setShake(false), 450)
  }

  function selectDuration(minutes: BookingDurationMinutes) {
    const option = durationOptions.find((item) => item.minutes === minutes)
    if (!option?.ok) {
      triggerShake()
      return
    }

    setDurationMinutes(minutes)
    if (!schedule) return

    if (!weekly) {
      const result = validateLessonDuration(
        slot.start_time,
        minutes,
        schedule,
        bookedRanges,
        timeZone,
        openSlots,
      )
      if (!result.ok) {
        setDurationError(result.reason)
        triggerShake()
      }
      return
    }

    const result = validateWeeklyLesson(
      slot,
      minutes,
      schedule,
      bookedRanges,
      openSlots,
      occupiedTimes,
      timeZone,
    )
    if (!result.ok) {
      setDurationError(result.reason)
      triggerShake()
    }
  }

  function triggerPolicyShake() {
    setShakePolicy(true)
    window.setTimeout(() => setShakePolicy(false), 450)
  }

  async function submitBooking(payLater: boolean) {
    if (!schedule || !canConfirm || confirmState === 'loading' || confirmState === 'success') {
      if (durationError || (hasPartialWeeks && !scheduleAnyway)) triggerShake()
      return
    }

    if (!policyAgreed) {
      triggerPolicyShake()
      return
    }

    if (!payLater && !hasEnoughCredits) return

    setConfirmState('loading')
    setSubmitError(null)

    async function materialize(targets: AvailabilitySlot[]) {
      const real: AvailabilitySlot[] = []
      for (const target of targets) {
        if (isVirtualSlot(target)) {
          real.push(await ensureOpenSlotForDuration(target.start_time, durationMinutes))
        } else {
          real.push(target)
        }
      }
      return real
    }

    try {
      if (weekly) {
        const realSlots = await materialize(availableSlots)
        if (realSlots.length === 0) throw new Error('No available weeks to book')

        const { data: bookedIds, error } = await supabase.rpc('student_book_weekly_slots', {
          p_slot_ids: realSlots.map((item) => item.id),
          p_duration_minutes: durationMinutes,
          p_pay_later: payLater,
        })

        if (error) {
          if (
            error.message.includes('Could not find the function') ||
            error.message.includes('student_book_weekly_slots')
          ) {
            throw new Error(
              'Run supabase/30-atomic-weekly-credit-notify-delete-all.sql in the Supabase SQL Editor, then try again.',
            )
          }
          throw error
        }

        setBookedLessonCount(Array.isArray(bookedIds) ? bookedIds.length : realSlots.length)
        setConfirmState('success')
        window.setTimeout(() => {
          onBooked()
          onClose()
        }, 900)
        return
      }

      const realSlots = await materialize([slot])
      const target = realSlots[0]
      if (!target) throw new Error('That time is not available')

      const { error } = await supabase.rpc('student_book_lesson', {
        p_slot_id: target.id,
        p_duration_minutes: durationMinutes,
        p_weekly: false,
        p_pay_later: payLater,
      })
      if (error) throw error

      setBookedLessonCount(1)
      setConfirmState('success')
      window.setTimeout(() => {
        onBooked()
        onClose()
      }, 900)
    } catch (err) {
      setConfirmState('error')
      setSubmitError(formatBookingError(err))
      triggerShake()
    }
  }

  const isSuccess = confirmState === 'success'
  const isLoading = confirmState === 'loading'

  return (
    <>
      <button
        type="button"
        aria-label="Close booking"
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-white shadow-xl ${
          shake ? 'modal-shake' : ''
        }`}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-sage uppercase">Book lesson</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{heading.time}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {heading.weekday}, {heading.monthDay}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-2xl leading-none text-ink-muted hover:text-ink"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {scheduleError ? (
            <p className="text-sm text-red-700">{scheduleError}</p>
          ) : !schedule ? (
            <p className="text-ink-muted">Loading options…</p>
          ) : isSuccess ? (
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
              <p className="mt-4 font-display text-2xl font-semibold">Confirmed</p>
              <p className="mt-2 text-sm text-ink-muted">
                {weekly
                  ? `${bookedLessonCount} weekly lesson${bookedLessonCount === 1 ? '' : 's'} are on your schedule.`
                  : 'Your lesson is on the schedule.'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-semibold text-ink-muted">Lesson length</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
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
                ) : null}
              </div>

              <label className="flex cursor-pointer items-start gap-3 border border-line px-4 py-3">
                <input
                  type="checkbox"
                  checked={weekly}
                  onChange={(event) => setWeekly(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-semibold">Schedule weekly</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Keeps about {WEEKLY_LESSON_COUNT} upcoming weeks at this time. As weeks pass,
                    new ones are added automatically; unavailable weeks are skipped and you get a
                    notification.
                  </span>
                </span>
              </label>

              {hasPartialWeeks ? (
                <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="font-semibold">Some weeks aren&apos;t available</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {unavailableWeeks.map((week) => (
                      <li key={week.startIso}>
                        {week.label}
                        <span className="text-amber-800/80">
                          {' '}
                          · {shortUnavailableReason(week.reason)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-amber-900/80">
                    {availableLessonCount} of {WEEKLY_LESSON_COUNT} weeks can still be booked.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={scheduleAnyway}
                      onChange={(event) => setScheduleAnyway(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="font-semibold">
                      Schedule the available weeks anyway
                    </span>
                  </label>
                </div>
              ) : null}

              <div className="border border-line bg-bg-elevated/40 px-4 py-3 text-sm">
                <p>
                  <span className="text-ink-muted">Total: </span>
                  <span className="font-semibold">{formatLessonCredits(totalLessonCredits)}</span>
                  {lessonCount > 1 ? (
                    <span className="text-ink-muted">
                      {' '}
                      ({formatLessonCredits(perLessonCredits)} × {lessonCount} lessons)
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-ink-muted">
                  Your balance:{' '}
                  <span
                    className={
                      creditBalance < 0
                        ? 'font-semibold text-red-700'
                        : creditBalance > 0
                          ? 'font-semibold text-green-700'
                          : 'font-semibold'
                    }
                  >
                    {formatLessonCredits(balanceCredits)}
                  </span>
                </p>
                <details className="mt-2 text-ink-muted">
                  <summary className="cursor-pointer font-medium hover:text-ink">
                    View in dollars
                  </summary>
                  <p className="mt-1">
                    Total {formatCredits(totalCost)}
                    {lessonCount > 1
                      ? ` (${formatCredits(perLessonCost)} × ${lessonCount})`
                      : ''}
                    {' · '}
                    Balance {formatCredits(creditBalance)}
                  </p>
                </details>
              </div>

              {!hasEnoughCredits ? (
                <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="font-semibold">You don&apos;t have enough credits</p>
                  <p className="mt-1">
                    You need {formatLessonCredits(totalLessonCredits)} but only have{' '}
                    {formatLessonCredits(balanceCredits)}. You can still book — credits are
                    reserved now and your balance may go negative until you add payment.
                  </p>
                </div>
              ) : null}

              {submitError ? (
                <p className="text-sm text-red-700" role="alert">
                  {submitError}
                </p>
              ) : null}

              <div
                className={`border px-4 py-3 ${
                  shakePolicy ? 'confirm-btn-shake border-red-400 bg-red-50' : 'border-line bg-bg-elevated/40'
                }`}
              >
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={policyAgreed}
                    onChange={(event) => setPolicyAgreed(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    {LATE_CANCEL_AGREEMENT}
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {!isSuccess && schedule && !scheduleError ? (
          <div className="border-t border-line px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {!hasEnoughCredits ? (
                <button
                  type="button"
                  disabled={!canConfirm || isLoading}
                  onClick={() => void submitBooking(true)}
                  className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                    isLoading ? 'bg-sage' : 'bg-sage-deep hover:bg-sage'
                  }`}
                >
                  {isLoading
                    ? 'Booking…'
                    : hasPartialWeeks && scheduleAnyway
                      ? `Pay later · ${availableLessonCount} lessons`
                      : 'Pay later'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canConfirm || isLoading}
                  onClick={() => void submitBooking(false)}
                  className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                    isLoading ? 'bg-sage' : 'bg-sage-deep hover:bg-sage'
                  }`}
                >
                  {isLoading
                    ? 'Booking…'
                    : hasPartialWeeks && scheduleAnyway
                      ? `Confirm ${availableLessonCount} lessons`
                      : 'Confirm'}
                </button>
              )}
            </div>
            {hasPartialWeeks && !scheduleAnyway ? (
              <p className="mt-2 text-center text-xs text-ink-muted">
                Check “Schedule the available weeks anyway” to continue.
              </p>
            ) : null}
            {!hasEnoughCredits ? (
              <p className="mt-2 text-center text-xs text-ink-muted">{STUDENT_PAY_LATER_HINT}</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </>
  )
}
