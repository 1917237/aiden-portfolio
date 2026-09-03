import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CalendarBooking } from '../../tutoring/calendarDayEvents'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { DEFAULT_BOOKING_DURATION_MINUTES } from '../../tutoring/bookingDurationConfig'
import { seedDemoCalendarData } from '../../tutoring/seedDemoData'
import { lessonToIcsEvent } from '../../tutoring/calendarIcs'
import { regenerateBookableSlots } from '../../tutoring/regenerateSlots'
import type { Blockout, DateAvailability, WeeklyCell } from '../../tutoring/scheduleTypes'
import type { StudentProfile } from '../../tutoring/types'
import { normalizeDateExtras } from '../../tutoring/extraAvailabilityUtils'
import { DATE_AVAILABILITY_SETUP, isMissingTableError } from '../../tutoring/supabaseErrors'
import {
  addDaysToDateKey,
  formatWeekRangeFromKeys,
  getDateKeyInTimezone,
  loadDisplayTimezone,
  startOfWeekFromDateKey,
  getWeekDaysForTimezone,
  isoToZonedParts,
} from '../../tutoring/timezoneUtils'
import { AdminTimezoneProvider, useAdminTimezone } from '../../tutoring/AdminTimezoneContext'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import { AdminNav } from './AdminNav'
import { CalendarSyncMenu } from './CalendarSyncMenu'
import { CollapsibleSection } from './CollapsibleSection'
import { ScheduleModal } from './ScheduleModal'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'
import type { SlotClickPayload } from './WeekCalendarGrid'
import { WeekCalendarGrid } from './WeekCalendarGrid'

export function TutoringCalendar() {
  const { session, profile, loading, profileError } = useTutoringSession()

  if (!loading && !session) {
    return <Navigate to="/tutoring/login" replace />
  }

  if (loading) {
    return <div className="px-4 py-20 text-ink-muted">Loading…</div>
  }

  if (profileError || !profile) {
    return <div className="px-4 py-20 text-red-700">{profileError ?? 'Could not load account.'}</div>
  }

  if (profile.role !== 'admin') {
    return <Navigate to="/tutoring/dashboard" replace />
  }

  return (
    <AdminTimezoneProvider profileDisplayTimezone={profile.display_timezone}>
      <TutoringCalendarPage />
    </AdminTimezoneProvider>
  )
}

function TutoringCalendarPage() {
  const { timeZone } = useAdminTimezone()
  const [weekStartKey, setWeekStartKey] = useState(() =>
    startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), loadDisplayTimezone())),
  )
  const [weeklyCells, setWeeklyCells] = useState<WeeklyCell[]>([])
  const [dateExtras, setDateExtras] = useState<DateAvailability[]>([])
  const [blockouts, setBlockouts] = useState<Blockout[]>([])
  const [bookings, setBookings] = useState<CalendarBooking[]>([])
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [slotSelection, setSlotSelection] = useState<SlotClickPayload | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const slotsSyncedRef = useRef(false)

  const weekDays = useMemo(
    () => getWeekDaysForTimezone(weekStartKey, timeZone),
    [weekStartKey, timeZone],
  )
  const weekEndKey = addDaysToDateKey(weekStartKey, 6)

  const loadWeek = useCallback(async () => {
    if (!hasLoaded) setDataLoading(true)
    setError(null)

    const [weeklyResult, extrasResult, blockoutsResult, bookingsResult, studentsResult] =
      await Promise.all([
        supabase.from('weekly_availability').select('day_of_week, start_minutes'),
        supabase
          .from('date_availability')
          .select('availability_date, start_minutes')
          .gte('availability_date', weekStartKey)
          .lte('availability_date', weekEndKey),
        supabase.from('availability_blockouts').select('*').order('blockout_date', { ascending: true }),
        supabase
          .from('bookings')
          .select(
            'id, status, slot_id, student_id, duration_minutes, availability_slots(start_time, end_time), profiles!bookings_student_id_fkey(full_name)',
          )
          .in('status', ['booked', 'completed'])
          .order('created_at', { ascending: true }),
        supabase
          .from('profiles')
          .select('id, full_name, credit_balance_cents, class_rate_cents')
          .eq('role', 'student')
          .order('full_name'),
      ])

    const extrasMissingTable =
      extrasResult.error && isMissingTableError(extrasResult.error.message, 'date_availability')

    if (
      weeklyResult.error ||
      blockoutsResult.error ||
      bookingsResult.error ||
      studentsResult.error ||
      (extrasResult.error && !extrasMissingTable)
    ) {
      setError(
        weeklyResult.error?.message ??
          extrasResult.error?.message ??
          blockoutsResult.error?.message ??
          bookingsResult.error?.message ??
          studentsResult.error?.message ??
          'Failed to load',
      )
      setDataLoading(false)
      return
    }

    if (extrasMissingTable) {
      setMessage(DATE_AVAILABILITY_SETUP)
    }

    setWeeklyCells((weeklyResult.data ?? []) as WeeklyCell[])
    setDateExtras(
      extrasMissingTable ? [] : normalizeDateExtras((extrasResult.data ?? []) as DateAvailability[]),
    )
    setBlockouts((blockoutsResult.data ?? []) as Blockout[])

    const weekBookings: CalendarBooking[] = []
    for (const row of bookingsResult.data ?? []) {
      const slotRaw = row.availability_slots
      const studentRaw = row.profiles
      const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as
        | { start_time: string; end_time: string }
        | null
        | undefined
      const student = (Array.isArray(studentRaw) ? studentRaw[0] : studentRaw) as
        | { full_name: string }
        | null
        | undefined
      if (!slot?.start_time || !student?.full_name) continue

      const dateKey = getDateKeyInTimezone(slot.start_time, timeZone)
      if (dateKey < weekStartKey || dateKey > weekEndKey) continue

      weekBookings.push({
        id: row.id as string,
        student_id: row.student_id as string,
        slot_id: row.slot_id as string,
        status: row.status as string,
        student_name: student.full_name,
        start_time: slot.start_time,
        end_time: slot.end_time,
        date_key: dateKey,
        duration_minutes: (row.duration_minutes as number | null) ?? DEFAULT_BOOKING_DURATION_MINUTES,
      })
    }

    setBookings(weekBookings)
    setStudents(
      ((studentsResult.data ?? []) as StudentProfile[]).map((s) => ({
        ...s,
        class_rate_cents: s.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS,
      })),
    )
    setHasLoaded(true)
    setDataLoading(false)
  }, [hasLoaded, timeZone, weekEndKey, weekStartKey])

  useEffect(() => {
    void (async () => {
      if (!slotsSyncedRef.current) {
        slotsSyncedRef.current = true
        try {
          await regenerateBookableSlots()
        } catch {
          // Calendar still loads; weekly save also regenerates.
        }
      }
      await loadWeek()
    })()
  }, [loadWeek])

  function shiftWeek(delta: number) {
    setWeekStartKey((current) => addDaysToDateKey(current, delta * 7))
  }

  function goToToday() {
    setWeekStartKey(startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), timeZone)))
  }

  function openSlot(payload: SlotClickPayload) {
    setSelectedBooking(null)
    setSlotSelection(payload)
    setError(null)
  }

  function openBooking(dateKey: string, bookingId: string) {
    const booking = bookings.find((b) => b.id === bookingId) ?? null
    setSelectedBooking(booking)
    setSlotSelection({
      dateKey,
      startMinutes: booking
        ? isoToZonedParts(booking.start_time, timeZone).startMinutes
        : 0,
      cellState: 'available',
    })
    setError(null)
  }

  function closeSchedule() {
    setSlotSelection(null)
    setSelectedBooking(null)
  }

  async function handleSeedDemo() {
    setSeeding(true)
    setError(null)
    setMessage(null)
    try {
      const result = await seedDemoCalendarData()
      setMessage(result.message)
      await loadWeek()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed demo data')
    }
    setSeeding(false)
  }

  const icsDownloadEvents = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === 'booked')
        .map((booking) =>
          lessonToIcsEvent({
            id: booking.id,
            start_time: booking.start_time,
            duration_minutes: booking.duration_minutes ?? DEFAULT_BOOKING_DURATION_MINUTES,
            title: booking.student_name ?? 'Lesson',
          }),
        ),
    [bookings],
  )

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-3 text-ink-muted">
            Click any time slot to schedule a lesson, block time off, or add extra availability.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={seeding}
            onClick={() => void handleSeedDemo()}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
          >
            {seeding ? 'Loading demo…' : 'Load demo data'}
          </button>
          <AdminNav current="calendar" />
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="border border-line px-3 py-1.5 text-sm font-semibold"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={goToToday}
            className="border border-line px-3 py-1.5 text-sm font-semibold"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="border border-line px-3 py-1.5 text-sm font-semibold"
          >
            Next →
          </button>
          <h2 className="ml-1 font-display text-2xl font-semibold">
            {formatWeekRangeFromKeys(weekStartKey, timeZone)}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TimesInTimezoneLabel timeZone={timeZone} />
        </div>
      </div>

      <div className="mt-4">
        <CollapsibleSection
          title="Calendar sync"
          description="Subscribe to all student lessons in Google or Apple Calendar."
          defaultOpen={false}
        >
          <CalendarSyncMenu downloadEvents={icsDownloadEvents} />
        </CollapsibleSection>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border border-line bg-white" />
          Available
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border border-line bg-bg-elevated/80" />
          Unavailable
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border border-sky-300 bg-sky-100" />
          Extra availability
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border border-red-400 bg-red-100" />
          Blocked
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 border border-sage-deep bg-sage" />
          Student session
        </span>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-sage-deep">{message}</p> : null}
      {dataLoading && !hasLoaded ? <p className="mt-4 text-ink-muted">Loading calendar…</p> : null}

      {hasLoaded ? (
        <WeekCalendarGrid
          weekDays={weekDays}
          weeklyCells={weeklyCells}
          dateExtras={dateExtras}
          blockouts={blockouts}
          bookings={bookings}
          timeZone={timeZone}
          onSlotClick={openSlot}
          onBookingClick={openBooking}
        />
      ) : null}

      {slotSelection ? (
        <ScheduleModal
          selection={slotSelection}
          students={students}
          blockouts={blockouts}
          dateExtras={dateExtras}
          booking={selectedBooking}
          timeZone={timeZone}
          onClose={closeSchedule}
          onSaved={() => {
            void loadWeek()
          }}
          onError={setError}
        />
      ) : null}
    </div>
  )
}
