import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type BookedRange } from '../../tutoring/bookingAvailabilityUtils'
import { loadStudentOpenSlots } from '../../tutoring/loadStudentOpenSlots'
import type { AvailabilitySlot } from '../../tutoring/types'
import {
  addDaysToDateKey,
  formatWeekRangeFromKeys,
  getDateKeyInTimezone,
  getWeekDaysForTimezone,
  loadDisplayTimezone,
  saveDisplayTimezone,
  startOfWeekFromDateKey,
} from '../../tutoring/timezoneUtils'
import { STUDENT_BOOKING_CREDIT_HINT } from '../../tutoring/studentCreditCopy'
import { StudentBookingModal } from './StudentBookingModal'
import { buildSlotsByCell, buildTakenCellsByKey, StudentWhen2MeetGrid } from './StudentWhen2MeetGrid'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'
import { TimezoneSelect } from './TimezoneSelect'

type Props = {
  creditBalance: number
  classRateCents: number
  onBooked: () => void
  timeZone?: string
  onTimeZoneChange?: (timeZone: string) => void
}

export function StudentBooking({
  creditBalance,
  classRateCents,
  onBooked,
  timeZone: controlledTimeZone,
  onTimeZoneChange,
}: Props) {
  const [internalTimeZone, setInternalTimeZone] = useState(loadDisplayTimezone)
  const timeZone = controlledTimeZone ?? internalTimeZone
  const [weekStartKey, setWeekStartKey] = useState<string | null>(null)
  const weekSyncedForTimeZone = useRef<string | null>(null)
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [allOpenSlots, setAllOpenSlots] = useState<AvailabilitySlot[]>([])
  const [occupiedTimes, setOccupiedTimes] = useState<Set<string>>(new Set())
  const [takenCellsByKey, setTakenCellsByKey] = useState<Set<string>>(new Set())
  const [bookedRanges, setBookedRanges] = useState<BookedRange[]>([])
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const todayKey = getDateKeyInTimezone(new Date(), timeZone)
    setWeekStartKey((current) => {
      if (current && weekSyncedForTimeZone.current === timeZone) return current
      weekSyncedForTimeZone.current = timeZone
      return startOfWeekFromDateKey(todayKey)
    })
  }, [timeZone])

  const weekDays = useMemo(
    () => (weekStartKey ? getWeekDaysForTimezone(weekStartKey, timeZone) : []),
    [weekStartKey, timeZone],
  )
  const weekEndKey = weekStartKey ? addDaysToDateKey(weekStartKey, 6) : ''

  const load = useCallback(async () => {
    if (!weekStartKey) return
    if (!hasLoaded) setLoading(true)
    setError(null)

    try {
      const { allOpenSlots: openSlots, bookedRanges: nextBookedRanges, takenStartIsos } =
        await loadStudentOpenSlots(timeZone)

      const weekSlots = openSlots.filter((slot) => {
        const dateKey = getDateKeyInTimezone(slot.start_time, timeZone)
        return dateKey >= weekStartKey && dateKey <= weekEndKey
      })

      const weekTakenIsos = takenStartIsos.filter((iso) => {
        const dateKey = getDateKeyInTimezone(iso, timeZone)
        return dateKey >= weekStartKey && dateKey <= weekEndKey
      })

      setSlots(weekSlots)
      setAllOpenSlots(openSlots)
      setTakenCellsByKey(buildTakenCellsByKey(weekTakenIsos, timeZone))
      setOccupiedTimes(new Set(nextBookedRanges.map((range) => range.start_time)))
      setBookedRanges(nextBookedRanges)
      setHasLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [hasLoaded, timeZone, weekEndKey, weekStartKey])

  useEffect(() => {
    void load()
  }, [load])

  const slotsByCell = useMemo(() => buildSlotsByCell(slots, timeZone), [slots, timeZone])
  const weekHasSlots = slots.length > 0

  function handleTimezoneChange(nextTimeZone: string) {
    saveDisplayTimezone(nextTimeZone)
    if (onTimeZoneChange) {
      onTimeZoneChange(nextTimeZone)
      return
    }
    setInternalTimeZone(nextTimeZone)
  }

  function shiftWeek(delta: number) {
    setWeekStartKey((current) => {
      if (!current) return current
      return addDaysToDateKey(current, delta * 7)
    })
  }

  function goToTodayWeek() {
    setWeekStartKey(startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), timeZone)))
  }

  function handleBooked() {
    setSelectedSlot(null)
    onBooked()
    void load()
  }

  return (
    <section className="mt-8 border-t border-line pt-8">
      <h2 className="font-display text-3xl font-semibold tracking-tight">Book a lesson</h2>

      <div className="mt-4 border border-sage/30 bg-sage/10 px-4 py-3 text-sm text-ink">
        <p>Green cells are open, amber cells are taken by another student. Click a green cell to choose lesson length and confirm.</p>
        <p className="mt-1 text-ink-muted">{STUDENT_BOOKING_CREDIT_HINT}</p>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
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
            onClick={goToTodayWeek}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Today
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
            {weekStartKey ? formatWeekRangeFromKeys(weekStartKey, timeZone) : ''}
          </span>
        </div>

        {onTimeZoneChange ? (
          <TimesInTimezoneLabel timeZone={timeZone} />
        ) : (
          <TimezoneSelect value={timeZone} onChange={handleTimezoneChange} />
        )}
      </div>

      {!weekStartKey || (loading && !hasLoaded) ? (
        <p className="mt-6 text-ink-muted">Loading availability…</p>
      ) : (
        <div className="mt-4">
          <StudentWhen2MeetGrid
            weekDays={weekDays}
            slotsByCell={slotsByCell}
            takenCellsByKey={takenCellsByKey}
            timeZone={timeZone}
            selectedSlotId={selectedSlot?.id ?? null}
            onSelectSlot={setSelectedSlot}
          />
        </div>
      )}

      {hasLoaded && !weekHasSlots ? (
        <p className="mt-4 text-sm text-ink-muted">
          No open times this week. Try another week with the arrows above.
        </p>
      ) : null}

      {selectedSlot ? (
        <StudentBookingModal
          slot={selectedSlot}
          creditBalance={creditBalance}
          classRateCents={classRateCents}
          openSlots={allOpenSlots}
          occupiedTimes={occupiedTimes}
          bookedRanges={bookedRanges}
          timeZone={timeZone}
          onClose={() => setSelectedSlot(null)}
          onBooked={handleBooked}
        />
      ) : null}
    </section>
  )
}
