import { Link, Navigate } from 'react-router-dom'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { formatCredits, formatSlotRange } from '../../tutoring/format'
import { AdminTimezoneProvider, useAdminTimezone } from '../../tutoring/AdminTimezoneContext'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import type { BookingWithDetails, StudentProfile } from '../../tutoring/types'
import { AdminNav } from './AdminNav'
import {
  AdminBookingRow,
  cancelBookingForAdmin,
  completeBookingForAdmin,
  type ConfirmState,
} from './AdminBookingRow'
import { AdminCreditHistory } from './AdminCreditHistory'
import { CreditBalance } from './CreditBalance'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'

type StudentRow = StudentProfile & {
  next_class_time: string | null
}

type StudentStats = {
  classesTaken: number
  totalEarnedCents: number
}

type DetailTab = 'lessons' | 'overview'

function formatNextLesson(iso: string | null, timeZone: string) {
  if (!iso) return 'None'
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
  })
}

function formatLessonDateBlock(iso: string, timeZone: string) {
  const date = new Date(iso)
  return {
    month: date.toLocaleDateString('en-US', { timeZone, month: 'short' }).toUpperCase(),
    day: date.toLocaleDateString('en-US', { timeZone, day: 'numeric' }),
  }
}

export function TutoringStudents() {
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
      <TutoringStudentsPage />
    </AdminTimezoneProvider>
  )
}

function TutoringStudentsPage() {
  const { timeZone } = useAdminTimezone()
  const [students, setStudents] = useState<StudentRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('lessons')
  const [bookings, setBookings] = useState<BookingWithDetails[]>([])
  const [stats, setStats] = useState<StudentStats | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [search, setSearch] = useState('')
  const [dataLoading, setDataLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [creditAmount, setCreditAmount] = useState('40')
  const [creditNote, setCreditNote] = useState('')
  const [creditMode, setCreditMode] = useState<'add' | 'deduct'>('add')
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditHistoryKey, setCreditHistoryKey] = useState(0)

  const [confirmStates, setConfirmStates] = useState<Record<string, ConfirmState>>({})
  const [cancelStates, setCancelStates] = useState<Record<string, ConfirmState>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [shakeIds, setShakeIds] = useState<Record<string, boolean>>({})

  const loadStudents = useCallback(async () => {
    if (!hasLoaded) setDataLoading(true)
    setError(null)

    const [studentsResult, bookingsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, credit_balance_cents, class_rate_cents')
        .eq('role', 'student')
        .order('full_name'),
      supabase
        .from('bookings')
        .select('student_id, status, availability_slots(start_time)')
        .eq('status', 'booked')
        .order('created_at', { ascending: true }),
    ])

    if (studentsResult.error || bookingsResult.error) {
      setError(studentsResult.error?.message ?? bookingsResult.error?.message ?? 'Failed to load')
      setDataLoading(false)
      return
    }

    const nextByStudent = new Map<string, string>()
    const now = Date.now()
    for (const row of bookingsResult.data ?? []) {
      const slotRaw = row.availability_slots
      const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as { start_time: string } | null
      if (!slot?.start_time) continue
      if (new Date(slot.start_time).getTime() < now) continue
      const studentId = row.student_id as string
      const existing = nextByStudent.get(studentId)
      if (!existing || slot.start_time < existing) {
        nextByStudent.set(studentId, slot.start_time)
      }
    }

    const rows: StudentRow[] = ((studentsResult.data ?? []) as StudentProfile[]).map((student) => ({
      ...student,
      class_rate_cents: student.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS,
      next_class_time: nextByStudent.get(student.id) ?? null,
    }))

    rows.sort((a, b) => {
      if (a.next_class_time && b.next_class_time) {
        return a.next_class_time.localeCompare(b.next_class_time)
      }
      if (a.next_class_time) return -1
      if (b.next_class_time) return 1
      return a.full_name.localeCompare(b.full_name)
    })

    setStudents(rows)
    setHasLoaded(true)
    setDataLoading(false)
  }, [hasLoaded])

  const loadStudentDetail = useCallback(async (studentId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setDetailLoading(true)
    setError(null)

    const [bookingsResult, statsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(
          '*, availability_slots(*), profiles!bookings_student_id_fkey(full_name, class_rate_cents)',
        )
        .eq('student_id', studentId)
        .in('status', ['booked', 'completed'])
        .order('created_at', { ascending: true }),
      supabase.from('bookings').select('status, charged_cents').eq('student_id', studentId),
    ])

    if (bookingsResult.error || statsResult.error) {
      setError(bookingsResult.error?.message ?? statsResult.error?.message ?? 'Failed to load student')
      setDetailLoading(false)
      return
    }

    const bookingRows = (bookingsResult.data ?? []) as BookingWithDetails[]
    bookingRows.sort((a, b) =>
      a.availability_slots.start_time.localeCompare(b.availability_slots.start_time),
    )

    const completed = (statsResult.data ?? []).filter((b) => b.status === 'completed')
    setBookings(bookingRows)
    setStats({
      classesTaken: completed.length,
      totalEarnedCents: completed.reduce((sum, b) => sum + (b.charged_cents ?? 0), 0),
    })
    setDetailLoading(false)
  }, [])

  useEffect(() => {
    void loadStudents()
  }, [loadStudents])

  useEffect(() => {
    if (!selectedId) {
      setBookings([])
      setStats(null)
      return
    }
    const student = students.find((s) => s.id === selectedId)
    if (student) {
      setRateInput(String(student.class_rate_cents / 100))
      setCreditNote('')
      setCreditMode('add')
    }
    void loadStudentDetail(selectedId)
  }, [loadStudentDetail, selectedId, students])

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedId) ?? null,
    [selectedId, students],
  )

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return students
    return students.filter((student) => student.full_name.toLowerCase().includes(query))
  }, [search, students])

  const upcomingBookings = useMemo(() => {
    const now = Date.now()
    return bookings.filter(
      (booking) =>
        booking.status === 'booked' &&
        new Date(booking.availability_slots.start_time).getTime() >= now,
    )
  }, [bookings])

  const pastBookings = useMemo(() => {
    const now = Date.now()
    return bookings
      .filter(
        (booking) =>
          booking.status === 'completed' ||
          (booking.status === 'booked' &&
            new Date(booking.availability_slots.start_time).getTime() < now),
      )
      .reverse()
  }, [bookings])

  function openStudent(studentId: string) {
    setSelectedId(studentId)
    setDetailTab('lessons')
    setMessage(null)
    setError(null)
    setConfirmStates({})
    setCancelStates({})
    setRowErrors({})
  }

  function closeStudent() {
    setSelectedId(null)
  }

  function refreshStudentData() {
    void loadStudents()
    if (selectedId) {
      void loadStudentDetail(selectedId, { silent: true })
      setCreditHistoryKey((key) => key + 1)
    }
  }

  async function handleSaveRate() {
    if (!selectedStudent) return
    const rateCents = Math.round(Number.parseFloat(rateInput) * 100)
    if (Number.isNaN(rateCents) || rateCents <= 0) {
      setError('Enter a valid rate.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ class_rate_cents: rateCents })
      .eq('id', selectedStudent.id)

    if (updateError) {
      setError(
        updateError.message.includes('class_rate_cents')
          ? 'Run supabase/08-student-rates.sql in the SQL Editor first.'
          : updateError.message,
      )
      setSaving(false)
      return
    }

    setMessage(`Rate updated to ${formatCredits(rateCents)}.`)
    setSaving(false)
    refreshStudentData()
  }

  async function handleCreditAdjust(event: FormEvent) {
    event.preventDefault()
    if (!selectedStudent) return

    const amountDollars = parseFloat(creditAmount)
    if (Number.isNaN(amountDollars) || amountDollars <= 0) {
      setError('Enter a valid amount.')
      return
    }

    const amountCents = Math.round(amountDollars * 100)
    setCreditSaving(true)
    setError(null)
    setMessage(null)

    if (creditMode === 'add') {
      const { error: rpcError } = await supabase.rpc('add_student_credits', {
        p_student_id: selectedStudent.id,
        p_amount_cents: amountCents,
        p_note: creditNote || null,
      })
      if (rpcError) {
        setError(rpcError.message)
        setCreditSaving(false)
        return
      }
      setMessage(`Added ${formatCredits(amountCents)} in credits.`)
    } else {
      const { error: rpcError } = await supabase.rpc('admin_adjust_credits', {
        p_student_id: selectedStudent.id,
        p_amount_cents: -amountCents,
        p_note: creditNote || null,
      })
      if (rpcError) {
        setError(
          rpcError.message.includes('admin_adjust_credits')
            ? 'Run supabase/44-admin-credits-invite.sql in the SQL Editor first.'
            : rpcError.message,
        )
        setCreditSaving(false)
        return
      }
      setMessage(`Removed ${formatCredits(amountCents)} in credits.`)
    }

    setCreditSaving(false)
    refreshStudentData()
  }

  async function handleConfirmBooking(booking: BookingWithDetails) {
    if (!selectedStudent) return
    setError(null)
    setMessage(null)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[booking.id]
      return next
    })
    setConfirmStates((prev) => ({ ...prev, [booking.id]: 'loading' }))

    try {
      const result = await completeBookingForAdmin(booking, selectedStudent.credit_balance_cents)
      setConfirmStates((prev) => ({ ...prev, [booking.id]: 'success' }))
      setMessage(result.message)
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      setConfirmStates((prev) => {
        const next = { ...prev }
        delete next[booking.id]
        return next
      })
      refreshStudentData()
    } catch (err) {
      const friendly = err instanceof Error ? err.message : 'Failed to confirm'
      setRowErrors((prev) => ({ ...prev, [booking.id]: friendly }))
      setConfirmStates((prev) => ({ ...prev, [booking.id]: 'error' }))
      setShakeIds((prev) => ({ ...prev, [booking.id]: true }))
      window.setTimeout(() => {
        setShakeIds((prev) => ({ ...prev, [booking.id]: false }))
      }, 500)
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
      await new Promise((resolve) => window.setTimeout(resolve, 750))
      setCancelStates((prev) => {
        const next = { ...prev }
        delete next[booking.id]
        return next
      })
      refreshStudentData()
    } catch (err) {
      const friendly = err instanceof Error ? err.message : 'Failed to cancel'
      setRowErrors((prev) => ({ ...prev, [booking.id]: friendly }))
      setCancelStates((prev) => ({ ...prev, [booking.id]: 'error' }))
      setShakeIds((prev) => ({ ...prev, [booking.id]: true }))
      window.setTimeout(() => {
        setShakeIds((prev) => ({ ...prev, [booking.id]: false }))
      }, 500)
    }
  }

  return (
    <div className="relative w-full px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">My students</h1>
          <div className="mt-2">
            <TimesInTimezoneLabel timeZone={timeZone} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminNav current="students" />
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Sign out
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-sage-deep">{message}</p> : null}

      <div className="mx-auto mt-6 max-w-md">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
            ⌕
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full rounded-full border border-line bg-white py-2.5 pl-9 pr-4 text-sm"
          />
        </div>

        {dataLoading && !hasLoaded ? (
          <p className="mt-6 text-ink-muted">Loading…</p>
        ) : filteredStudents.length === 0 ? (
          <p className="mt-6 text-ink-muted">No students found.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-line bg-white">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[28%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="px-4 py-3 text-left font-semibold">Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Credits</th>
                  <th className="px-4 py-3 text-left font-semibold">Next lesson</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student, index) => {
                  const isSelected = selectedId === student.id
                  return (
                    <tr
                      key={student.id}
                      className={`cursor-pointer border-b border-line last:border-b-0 ${
                        isSelected ? 'bg-sage/20' : index % 2 === 1 ? 'bg-bg-elevated/40' : 'bg-white'
                      } hover:bg-bg-elevated/60`}
                      onClick={() => openStudent(student.id)}
                    >
                      <td className="px-4 py-3.5 text-left font-semibold text-ink">
                        {student.full_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-left">
                        <CreditBalance cents={student.credit_balance_cents} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-left text-ink-muted">
                        {formatNextLesson(student.next_class_time, timeZone)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedStudent ? (
        <>
          <button
            type="button"
            aria-label="Close student details"
            className="tutoring-modal-backdrop fixed inset-0 z-40 bg-black/20"
            onClick={closeStudent}
          />
          <aside className="tutoring-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
            <div className="border-b border-line px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-2xl font-semibold">{selectedStudent.full_name}</h2>
                <button
                  type="button"
                  onClick={closeStudent}
                  className="text-2xl leading-none text-ink-muted hover:text-ink"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="mt-4 flex gap-6 border-b border-line">
                {(['lessons', 'overview'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDetailTab(tab)}
                    className={`border-b-2 px-1 pb-3 text-sm font-semibold capitalize ${
                      detailTab === tab
                        ? 'border-sage-deep text-ink'
                        : 'border-transparent text-ink-muted hover:text-ink'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailLoading ? (
                <p className="text-ink-muted">Loading…</p>
              ) : detailTab === 'lessons' ? (
                <div className="space-y-6">
                  <p className="text-sm text-ink-muted">
                    <Link
                      to="/tutoring/calendar"
                      className="font-semibold text-sage-deep underline-offset-2 hover:underline"
                    >
                      Book or reschedule on Calendar →
                    </Link>
                  </p>

                  <div>
                    <h3 className="text-sm font-semibold text-ink-muted">Upcoming</h3>
                    {upcomingBookings.length === 0 ? (
                      <p className="mt-3 text-sm text-ink-muted">No upcoming lessons.</p>
                    ) : (
                      <ul className="mt-3 space-y-3">
                        {upcomingBookings.map((booking) => (
                          <AdminBookingRow
                            key={booking.id}
                            booking={booking}
                            timeZone={timeZone}
                            balanceCents={selectedStudent.credit_balance_cents}
                            confirmState={confirmStates[booking.id] ?? 'idle'}
                            cancelState={cancelStates[booking.id] ?? 'idle'}
                            rowError={rowErrors[booking.id] ?? null}
                            shake={shakeIds[booking.id] ?? false}
                            hideStudentName
                            showCalendarLink
                            onConfirm={() => void handleConfirmBooking(booking)}
                            onCancel={(comment) => void handleCancelBooking(booking, comment)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>

                  {pastBookings.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-ink-muted">Past</h3>
                      <ul className="mt-3 space-y-3">
                        {pastBookings.map((booking) => {
                          const dateBlock = formatLessonDateBlock(
                            booking.availability_slots.start_time,
                            timeZone,
                          )
                          const label = booking.status === 'completed' ? 'Completed' : 'Past'
                          return (
                            <li
                              key={booking.id}
                              className="flex items-center gap-3 border border-line px-3 py-3"
                            >
                              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center border border-line bg-bg-elevated/40 text-center">
                                <span className="text-[10px] font-semibold uppercase text-ink-muted">
                                  {dateBlock.month}
                                </span>
                                <span className="text-lg font-semibold leading-none">
                                  {dateBlock.day}
                                </span>
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">
                                  {formatSlotRange(
                                    booking.availability_slots.start_time,
                                    booking.availability_slots.end_time,
                                    timeZone,
                                  )}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-bg-elevated px-2.5 py-1 text-xs font-semibold text-ink-muted">
                                {label}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="font-display text-3xl font-semibold">
                        {stats ? formatCredits(stats.totalEarnedCents) : '…'}
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">Income earned</p>
                    </div>
                    <div>
                      <p className="font-display text-3xl font-semibold">
                        {stats?.classesTaken ?? '…'}
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">Lessons</p>
                    </div>
                  </div>

                  <div className="border border-line p-4">
                    <h3 className="font-semibold">Student info</h3>
                    <dl className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-ink-muted">Lesson price</dt>
                        <dd className="font-semibold">
                          {formatCredits(selectedStudent.class_rate_cents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-ink-muted">Credit balance</dt>
                        <dd>
                          <CreditBalance cents={selectedStudent.credit_balance_cents} />
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-5 border-t border-line pt-4">
                      <label className="block">
                        <span className="text-sm font-semibold">Update lesson price ($)</span>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={rateInput}
                          onChange={(e) => setRateInput(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-3 py-2"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveRate()}
                        className="mt-3 bg-sage-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {saving ? 'Saving…' : 'Save price'}
                      </button>
                    </div>
                  </div>

                  <div className="border border-line p-4">
                    <h3 className="font-semibold">Adjust credits</h3>
                    <p className="mt-1 text-sm text-ink-muted">
                      Add Zelle payments or remove credits (refunds, corrections).
                    </p>
                    <form className="mt-4 space-y-3" onSubmit={(e) => void handleCreditAdjust(e)}>
                      <div className="flex gap-2">
                        {(['add', 'deduct'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setCreditMode(mode)}
                            className={`flex-1 border px-3 py-2 text-sm font-semibold ${
                              creditMode === mode
                                ? mode === 'add'
                                  ? 'border-sage-deep bg-sage/20'
                                  : 'border-red-400 bg-red-50'
                                : 'border-line hover:bg-bg-elevated'
                            }`}
                          >
                            {mode === 'add' ? 'Add' : 'Remove'}
                          </button>
                        ))}
                      </div>
                      <label className="block">
                        <span className="text-sm font-semibold">Amount ($)</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold">Note (optional)</span>
                        <input
                          type="text"
                          value={creditNote}
                          onChange={(e) => setCreditNote(e.target.value)}
                          placeholder="Zelle payment, refund, etc."
                          className="mt-1 w-full border border-line bg-white px-3 py-2"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={creditSaving}
                        className={`px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                          creditMode === 'add' ? 'bg-sage-deep' : 'bg-red-700'
                        }`}
                      >
                        {creditSaving
                          ? 'Saving…'
                          : creditMode === 'add'
                            ? 'Add credits'
                            : 'Remove credits'}
                      </button>
                    </form>
                  </div>

                  <div>
                    <h3 className="font-semibold">Credit history</h3>
                    <div className="mt-3">
                      <AdminCreditHistory
                        studentId={selectedStudent.id}
                        classRateCents={selectedStudent.class_rate_cents}
                        refreshKey={creditHistoryKey}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  )
}
