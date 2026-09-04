import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { formatCredits } from '../../tutoring/format'
import type { BookingWithDetails, StudentProfile } from '../../tutoring/types'
import {
  addDaysToDateKey,
  formatWeekRangeFromKeys,
  getDateKeyInTimezone,
  startOfWeekFromDateKey,
} from '../../tutoring/timezoneUtils'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'
import { supabase } from '../../lib/supabase'
import {
  AdminBookingRow,
  cancelBookingForAdmin,
  completeBookingForAdmin,
  type ConfirmState,
} from './AdminBookingRow'
import { AdminInviteStudent } from './AdminInviteStudent'
import { AdminWeeklySeriesPanel } from './AdminWeeklySeriesPanel'
import { AdminMeetingLinksPanel } from './AdminMeetingLinksPanel'
import { CollapsibleSection } from './CollapsibleSection'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'
import { WeeklyScheduler } from './WeeklyScheduler'

type Props = {
  onUpdated: () => void
}

type CreditRequestRow = {
  id: string
  amount_cents: number
  note: string | null
  created_at: string
  profiles: { full_name: string }
}

export function AdminTools({ onUpdated }: Props) {
  const { timeZone } = useAdminTimezone()
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [creditRequests, setCreditRequests] = useState<CreditRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dataRefreshKey, setDataRefreshKey] = useState(0)

  const [creditStudentId, setCreditStudentId] = useState('')
  const [creditAmount, setCreditAmount] = useState('40')
  const [creditNote, setCreditNote] = useState('Zelle payment')
  const [creditMode, setCreditMode] = useState<'add' | 'deduct'>('add')

  const [confirmStates, setConfirmStates] = useState<Record<string, ConfirmState>>({})
  const [cancelStates, setCancelStates] = useState<Record<string, ConfirmState>>({})
  const [creditActionStates, setCreditActionStates] = useState<Record<string, ConfirmState>>({})
  const [shakeIds, setShakeIds] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const alertRef = useRef<HTMLDivElement | null>(null)

  const weekStartKey = useMemo(
    () => startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), timeZone)),
    [timeZone],
  )
  const weekEndKey = useMemo(() => addDaysToDateKey(weekStartKey, 6), [weekStartKey])
  const weekLabel = useMemo(
    () => formatWeekRangeFromKeys(weekStartKey, timeZone),
    [weekStartKey, timeZone],
  )

  const load = useCallback(async () => {
    if (!hasLoaded) setLoading(true)
    setError(null)

    const [studentsResult, bookingsResult, creditRequestsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, credit_balance_cents, class_rate_cents')
        .eq('role', 'student')
        .order('full_name'),
      supabase
        .from('bookings')
        .select(
          '*, availability_slots(*), profiles!bookings_student_id_fkey(full_name, class_rate_cents)',
        )
        .eq('status', 'booked')
        .order('created_at', { ascending: true }),
      supabase
        .from('credit_requests')
        .select('id, amount_cents, note, created_at, profiles!credit_requests_student_id_fkey(full_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ])

    if (studentsResult.error || bookingsResult.error) {
      setError(studentsResult.error?.message ?? bookingsResult.error?.message ?? 'Failed to load')
      setLoading(false)
      return
    }

    setStudents(
      ((studentsResult.data ?? []) as StudentProfile[]).map((s) => ({
        ...s,
        class_rate_cents: s.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS,
      })),
    )
    setBookings((bookingsResult.data ?? []) as BookingWithDetails[])

    if (creditRequestsResult.error) {
      setCreditRequests([])
    } else {
      setCreditRequests(
        (creditRequestsResult.data ?? []).map((row) => {
          const raw = row as {
            id: string
            amount_cents: number
            note: string | null
            created_at: string
            profiles: { full_name: string } | { full_name: string }[] | null
          }
          const profile = Array.isArray(raw.profiles) ? raw.profiles[0] : raw.profiles
          return {
            id: raw.id,
            amount_cents: raw.amount_cents,
            note: raw.note,
            created_at: raw.created_at,
            profiles: { full_name: profile?.full_name ?? 'Student' },
          }
        }),
      )
    }

    setHasLoaded(true)
    setLoading(false)
  }, [hasLoaded])

  useEffect(() => {
    void load()
  }, [load, dataRefreshKey])

  const weekBookings = useMemo(
    () =>
      bookings
        .filter((booking) => {
          const dateKey = getDateKeyInTimezone(booking.availability_slots.start_time, timeZone)
          return dateKey >= weekStartKey && dateKey <= weekEndKey
        })
        .sort((a, b) =>
          a.availability_slots.start_time.localeCompare(b.availability_slots.start_time),
        ),
    [bookings, timeZone, weekEndKey, weekStartKey],
  )

  function refreshAll() {
    onUpdated()
    setDataRefreshKey((value) => value + 1)
  }

  function showRowFailure(bookingId: string, errorMessage: string) {
    setError(errorMessage)
    setRowErrors((prev) => ({ ...prev, [bookingId]: errorMessage }))
    setConfirmStates((prev) => ({ ...prev, [bookingId]: 'error' }))
    setShakeIds((prev) => ({ ...prev, [bookingId]: true }))
    window.setTimeout(() => {
      setShakeIds((prev) => ({ ...prev, [bookingId]: false }))
    }, 500)
    window.setTimeout(() => {
      rowRefs.current[bookingId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  async function handleAdjustCredits(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const amountDollars = parseFloat(creditAmount)
    if (!creditStudentId || Number.isNaN(amountDollars) || amountDollars <= 0) {
      setError('Pick a student and enter a valid amount.')
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const amountCents = Math.round(amountDollars * 100)

    if (creditMode === 'add') {
      const { error: rpcError } = await supabase.rpc('add_student_credits', {
        p_student_id: creditStudentId,
        p_amount_cents: amountCents,
        p_note: creditNote || null,
      })
      if (rpcError) {
        setError(
          rpcError.message.includes('Could not find the function')
            ? 'Run supabase/02-functions.sql in the SQL Editor first.'
            : rpcError.message,
        )
        alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      setMessage(`Added ${formatCredits(amountCents)} in credits.`)
    } else {
      const { error: rpcError } = await supabase.rpc('admin_adjust_credits', {
        p_student_id: creditStudentId,
        p_amount_cents: -amountCents,
        p_note: creditNote || null,
      })
      if (rpcError) {
        setError(
          rpcError.message.includes('admin_adjust_credits')
            ? 'Run supabase/44-admin-credits-invite.sql in the SQL Editor first.'
            : rpcError.message,
        )
        alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      setMessage(`Removed ${formatCredits(amountCents)} from balance.`)
    }

    setCreditAmount('40')
    refreshAll()
  }

  async function handleCompleteBooking(booking: BookingWithDetails) {
    setError(null)
    setMessage(null)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[booking.id]
      return next
    })
    setConfirmStates((prev) => ({ ...prev, [booking.id]: 'loading' }))

    const student = students.find((s) => s.id === booking.student_id)
    const balance = student?.credit_balance_cents ?? 0

    try {
      const result = await completeBookingForAdmin(booking, balance)
      setConfirmStates((prev) => ({ ...prev, [booking.id]: 'success' }))
      setMessage(result.message)
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      setConfirmStates((prev) => {
        const next = { ...prev }
        delete next[booking.id]
        return next
      })
      refreshAll()
    } catch (err) {
      const friendly = err instanceof Error ? err.message : 'Failed to confirm'
      showRowFailure(booking.id, friendly)
    }
  }

  async function handleCancelBooking(booking: BookingWithDetails, comment: string | null) {
    setError(null)
    setMessage(null)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[booking.id]
      return next
    })
    setCancelStates((prev) => ({ ...prev, [booking.id]: 'loading' }))

    try {
      const result = await cancelBookingForAdmin(booking.id, booking.profiles.full_name, comment)
      setCancelStates((prev) => ({ ...prev, [booking.id]: 'success' }))
      setMessage(result)
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      setCancelStates((prev) => {
        const next = { ...prev }
        delete next[booking.id]
        return next
      })
      refreshAll()
    } catch (err) {
      const friendly = err instanceof Error ? err.message : 'Failed to cancel'
      setError(friendly)
      setRowErrors((prev) => ({ ...prev, [booking.id]: friendly }))
      setCancelStates((prev) => ({ ...prev, [booking.id]: 'error' }))
      setShakeIds((prev) => ({ ...prev, [booking.id]: true }))
      window.setTimeout(() => {
        setShakeIds((prev) => ({ ...prev, [booking.id]: false }))
      }, 500)
    }
  }

  async function handleApproveCreditRequest(request: CreditRequestRow) {
    setError(null)
    setMessage(null)
    setCreditActionStates((prev) => ({ ...prev, [request.id]: 'loading' }))

    const { error: rpcError } = await supabase.rpc('approve_credit_request', {
      p_request_id: request.id,
    })

    if (rpcError) {
      setError(
        rpcError.message.includes('Could not find the function')
          ? 'Run supabase/14-credit-requests.sql in the SQL Editor first.'
          : rpcError.message,
      )
      setCreditActionStates((prev) => ({ ...prev, [request.id]: 'error' }))
      return
    }

    setCreditActionStates((prev) => ({ ...prev, [request.id]: 'success' }))
    setMessage(`Added ${formatCredits(request.amount_cents)} for ${request.profiles.full_name}.`)
    refreshAll()
  }

  async function handleRejectCreditRequest(request: CreditRequestRow) {
    setError(null)
    setMessage(null)
    setCreditActionStates((prev) => ({ ...prev, [`reject-${request.id}`]: 'loading' }))

    const { error: rpcError } = await supabase.rpc('reject_credit_request', {
      p_request_id: request.id,
    })

    if (rpcError) {
      setError(rpcError.message)
      setCreditActionStates((prev) => ({ ...prev, [`reject-${request.id}`]: 'error' }))
      return
    }

    setMessage(`Declined credit request from ${request.profiles.full_name}.`)
    refreshAll()
  }

  function renderBookingList(items: BookingWithDetails[]) {
    return (
      <ul className="mt-4 space-y-2">
        {items.map((booking) => {
          const student = students.find((s) => s.id === booking.student_id)
          return (
            <AdminBookingRow
              key={booking.id}
              booking={booking}
              timeZone={timeZone}
              balanceCents={student?.credit_balance_cents ?? 0}
              confirmState={confirmStates[booking.id] ?? 'idle'}
              cancelState={cancelStates[booking.id] ?? 'idle'}
              rowError={rowErrors[booking.id] ?? null}
              shake={Boolean(shakeIds[booking.id])}
              onConfirm={() => void handleCompleteBooking(booking)}
              onCancel={(comment) => void handleCancelBooking(booking, comment)}
            />
          )
        })}
      </ul>
    )
  }

  return (
    <div className="mt-8 space-y-10 border-t border-line pt-8">
      <TimesInTimezoneLabel timeZone={timeZone} />

      <div ref={alertRef} className="space-y-2">
        {error ? (
          <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}
        {message ? (
          <p className="border border-sage/30 bg-sage/10 px-3 py-2 text-sm text-sage-deep">{message}</p>
        ) : null}
      </div>
      {loading && !hasLoaded ? <p className="text-ink-muted">Loading admin data…</p> : null}

      {hasLoaded ? (
        <>
          <CollapsibleSection
            title="Invite student"
            description="Sends a signup email. Their account is created as a student automatically."
            defaultOpen={false}
          >
            <AdminInviteStudent onInvited={() => refreshAll()} />
          </CollapsibleSection>

          <WeeklyScheduler
            onSaved={() => refreshAll()}
            onError={setError}
            onMessage={setMessage}
          />

          <CollapsibleSection
            title="This week"
            description={`${weekLabel} · ${weekBookings.length} booked class${weekBookings.length === 1 ? '' : 'es'}`}
            defaultOpen={true}
          >
            {weekBookings.length === 0 ? (
              <p className="text-ink-muted">No classes scheduled this week.</p>
            ) : (
              renderBookingList(weekBookings)
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Join links"
            description="One-off class links, one link per weekly series, and late-cancel waives."
            defaultOpen={false}
          >
            <AdminMeetingLinksPanel refreshKey={dataRefreshKey} />
          </CollapsibleSection>

          <CollapsibleSection
            title="Weekly series"
            description="Active rolling or fixed weekly bookings by student."
            defaultOpen={false}
          >
            <AdminWeeklySeriesPanel refreshKey={dataRefreshKey} />
          </CollapsibleSection>

          {creditRequests.length > 0 ? (
            <section>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Confirm credit payments
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Students submitted these payments. Approve to add credits to their account.
              </p>
              <ul className="mt-4 space-y-2">
                {creditRequests.map((request) => {
                  const approveState = creditActionStates[request.id] ?? 'idle'
                  const rejectState = creditActionStates[`reject-${request.id}`] ?? 'idle'
                  const isBusy = approveState === 'loading' || rejectState === 'loading'

                  return (
                    <li key={request.id} className="border border-line px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{request.profiles.full_name}</p>
                          <p className="text-sm text-ink-muted">
                            {formatCredits(request.amount_cents)}
                            {request.note ? ` · ${request.note}` : null}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isBusy || approveState === 'success'}
                            onClick={() => void handleRejectCreditRequest(request)}
                            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
                          >
                            {rejectState === 'loading' ? 'Declining…' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || approveState === 'success'}
                            onClick={() => void handleApproveCreditRequest(request)}
                            className="bg-sage-deep px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {approveState === 'loading'
                              ? 'Confirming…'
                              : approveState === 'success'
                                ? 'Confirmed'
                                : 'Confirm payment'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Adjust credits</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Add Zelle payments or remove credits manually (refunds, corrections).
            </p>
            <form onSubmit={handleAdjustCredits} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-sm font-semibold">Student</span>
                <select
                  required
                  value={creditStudentId}
                  onChange={(e) => setCreditStudentId(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2"
                >
                  <option value="">Select student…</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name} ({formatCredits(student.credit_balance_cents)})
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {(['add', 'deduct'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCreditMode(mode)}
                    className={`border px-3 py-1.5 text-sm font-semibold ${
                      creditMode === mode
                        ? 'border-sage-deep bg-sage/15 text-ink'
                        : 'border-line hover:bg-bg-elevated'
                    }`}
                  >
                    {mode === 'add' ? 'Add credits' : 'Remove credits'}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-sm font-semibold">Amount ($)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Note</span>
                <input
                  type="text"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2"
                />
              </label>
              <button
                type="submit"
                className={`px-4 py-2 font-semibold text-white ${
                  creditMode === 'add' ? 'bg-sage-deep' : 'bg-red-700'
                }`}
              >
                {creditMode === 'add' ? 'Add credits' : 'Remove credits'}
              </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  )
}
