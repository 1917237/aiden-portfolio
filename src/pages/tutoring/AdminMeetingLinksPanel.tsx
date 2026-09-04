import { useCallback, useEffect, useRef, useState } from 'react'
import { formatSlotRange } from '../../tutoring/format'
import { supabase } from '../../lib/supabase'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'

type IndividualRow = {
  kind: 'individual'
  id: string
  student_name: string
  start_time: string
  end_time: string
}

type WeeklyRow = {
  kind: 'weekly'
  series_id: string
  student_name: string
  start_time: string
  end_time: string
  upcoming_count: number
}

type LinkRow = IndividualRow | WeeklyRow

type LateCancelRow = {
  id: string
  charged_cents: number
  student_name: string
  start_time: string
  end_time: string
}

type Props = {
  refreshKey?: number
}

function unwrapSlot(raw: unknown) {
  const slot = (Array.isArray(raw) ? raw[0] : raw) as
    | { start_time: string; end_time: string }
    | null
  return slot
}

function unwrapProfile(raw: unknown) {
  const profile = (Array.isArray(raw) ? raw[0] : raw) as { full_name: string } | null
  return profile?.full_name ?? 'Student'
}

export function AdminMeetingLinksPanel({ refreshKey = 0 }: Props) {
  const { timeZone } = useAdminTimezone()
  const [rows, setRows] = useState<LinkRow[]>([])
  const [lateCancels, setLateCancels] = useState<LateCancelRow[]>([])
  const [draftByKey, setDraftByKey] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [successKey, setSuccessKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true)
    setError(null)

    const [bookingsResult, seriesResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(
          'id, series_id, status, meeting_url, charged_cents, availability_slots(start_time, end_time), profiles!bookings_student_id_fkey(full_name)',
        )
        .in('status', ['booked', 'cancelled']),
      supabase
        .from('weekly_series')
        .select('id, meeting_url, active, profiles!weekly_series_student_id_fkey(full_name)')
        .eq('active', true),
    ])

    if (bookingsResult.error) {
      setError(
        bookingsResult.error.message.includes('meeting_url')
          ? 'Run supabase/48-late-cancel-and-meeting-links.sql in the SQL Editor first.'
          : bookingsResult.error.message,
      )
      hasLoadedRef.current = true
      setLoading(false)
      return
    }

    const seriesMeetingById = new Map<string, string | null>()
    const seriesNameById = new Map<string, string>()
    if (!seriesResult.error) {
      for (const series of seriesResult.data ?? []) {
        seriesMeetingById.set(
          series.id as string,
          ((series.meeting_url as string | null) ?? '').trim() || null,
        )
        seriesNameById.set(series.id as string, unwrapProfile(series.profiles))
      }
    }

    const now = Date.now()
    const nextRows: LinkRow[] = []
    const nextLate: LateCancelRow[] = []
    const drafts: Record<string, string> = {}
    const weeklySeen = new Set<string>()

    type WeeklyAccum = {
      series_id: string
      student_name: string
      start_time: string
      end_time: string
      upcoming_count: number
    }
    const weeklyById = new Map<string, WeeklyAccum>()

    for (const row of bookingsResult.data ?? []) {
      const slot = unwrapSlot(row.availability_slots)
      if (!slot?.start_time) continue
      const name = unwrapProfile(row.profiles)

      if (row.status === 'booked' && new Date(slot.start_time).getTime() >= now) {
        const seriesId = (row.series_id as string | null) ?? null
        const bookingUrl = ((row.meeting_url as string | null) ?? '').trim()

        if (seriesId) {
          const seriesUrl = seriesMeetingById.get(seriesId)
          // Show once only when the series itself still needs a link.
          if (!seriesUrl && !weeklySeen.has(seriesId)) {
            weeklySeen.add(seriesId)
            weeklyById.set(seriesId, {
              series_id: seriesId,
              student_name: seriesNameById.get(seriesId) ?? name,
              start_time: slot.start_time,
              end_time: slot.end_time,
              upcoming_count: 1,
            })
            drafts[`weekly:${seriesId}`] = ''
          } else if (!seriesUrl && weeklyById.has(seriesId)) {
            const existing = weeklyById.get(seriesId)!
            existing.upcoming_count += 1
            if (slot.start_time < existing.start_time) {
              existing.start_time = slot.start_time
              existing.end_time = slot.end_time
            }
          }
        } else if (!bookingUrl) {
          nextRows.push({
            kind: 'individual',
            id: row.id as string,
            student_name: name,
            start_time: slot.start_time,
            end_time: slot.end_time,
          })
          drafts[`individual:${row.id}`] = ''
        }
      }

      if (
        row.status === 'cancelled' &&
        typeof row.charged_cents === 'number' &&
        row.charged_cents > 0
      ) {
        nextLate.push({
          id: row.id as string,
          charged_cents: row.charged_cents,
          student_name: name,
          start_time: slot.start_time,
          end_time: slot.end_time,
        })
      }
    }

    for (const weekly of weeklyById.values()) {
      nextRows.push({
        kind: 'weekly',
        series_id: weekly.series_id,
        student_name: weekly.student_name,
        start_time: weekly.start_time,
        end_time: weekly.end_time,
        upcoming_count: weekly.upcoming_count,
      })
    }

    nextRows.sort((a, b) => a.start_time.localeCompare(b.start_time))
    nextLate.sort((a, b) => b.start_time.localeCompare(a.start_time))

    setRows(nextRows)
    setLateCancels(nextLate)
    setDraftByKey(drafts)
    hasLoadedRef.current = true
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  function rowKey(row: LinkRow) {
    return row.kind === 'individual' ? `individual:${row.id}` : `weekly:${row.series_id}`
  }

  async function saveLink(row: LinkRow) {
    const key = rowKey(row)
    if (busyKey === key || successKey === key) return

    const url = (draftByKey[key] ?? '').trim()
    if (!url) {
      setError('Paste a join link first.')
      return
    }

    setBusyKey(key)
    setError(null)
    setMessage(null)

    if (row.kind === 'weekly') {
      const { error: seriesError } = await supabase.rpc('admin_set_series_meeting_url', {
        p_series_id: row.series_id,
        p_url: url,
      })
      setBusyKey(null)
      if (seriesError) {
        setError(seriesError.message)
        return
      }
    } else {
      const { error: rpcError } = await supabase.rpc('admin_set_booking_meeting_url', {
        p_booking_id: row.id,
        p_url: url,
      })
      setBusyKey(null)
      if (rpcError) {
        setError(rpcError.message)
        return
      }
    }

    setSuccessKey(key)
    window.setTimeout(() => {
      setRows((prev) => prev.filter((item) => rowKey(item) !== key))
      setDraftByKey((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setSuccessKey((current) => (current === key ? null : current))
      void load()
    }, 750)
  }

  async function waiveLateCancel(id: string) {
    setBusyKey(id)
    setError(null)
    setMessage(null)
    const { error: rpcError } = await supabase.rpc('admin_waive_late_cancel', {
      p_booking_id: id,
    })
    setBusyKey(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setMessage('Late fee waived — credits refunded.')
    void load()
  }

  if (loading && !hasLoadedRef.current) {
    return <p className="text-sm text-ink-muted">Loading join links…</p>
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-sage-deep">{message}</p> : null}

      <div>
        <h3 className="font-semibold">Classes missing a link</h3>
        <p className="mt-1 text-xs text-ink-muted">
          One-off classes get their own link. Weekly series get one link for the whole series.
        </p>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Every upcoming class has a join link.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rows.map((row) => {
              const key = rowKey(row)
              const isBusy = busyKey === key
              const isSuccess = successKey === key
              const idleLabel = row.kind === 'weekly' ? 'Save weekly link' : 'Save class link'
              return (
                <li key={key} className="border border-line bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{row.student_name}</p>
                    <span className="border border-line px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {row.kind === 'weekly' ? 'Weekly' : 'One-off'}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.kind === 'weekly'
                      ? `Next: ${formatSlotRange(row.start_time, row.end_time, timeZone)} · ${row.upcoming_count} upcoming`
                      : formatSlotRange(row.start_time, row.end_time, timeZone)}
                  </p>
                  <input
                    type="url"
                    value={draftByKey[key] ?? ''}
                    onChange={(event) =>
                      setDraftByKey((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void saveLink(row)
                      }
                    }}
                    disabled={isBusy || isSuccess}
                    placeholder={
                      row.kind === 'weekly'
                        ? 'Weekly series join link (https://…)'
                        : 'Class join link (https://…)'
                    }
                    className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={isBusy || isSuccess}
                    onClick={() => void saveLink(row)}
                    className={`mt-2 inline-flex min-w-[9.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-100 ${
                      isSuccess
                        ? 'confirm-btn-success bg-sage text-white'
                        : 'border border-line hover:bg-bg-elevated'
                    }`}
                  >
                    {isBusy ? (
                      <span className="text-xs tracking-wide">Saving…</span>
                    ) : isSuccess ? (
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
                      <span>{idleLabel}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {lateCancels.length > 0 ? (
        <div>
          <h3 className="font-semibold">Late cancels (credits kept)</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Student cancelled inside 12 hours. Refund if you waive the fee.
          </p>
          <ul className="mt-3 space-y-2">
            {lateCancels.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-red-200 bg-red-50/50 px-4 py-3"
              >
                <div>
                  <p className="font-semibold">{row.student_name}</p>
                  <p className="text-sm text-ink-muted">
                    {formatSlotRange(row.start_time, row.end_time, timeZone)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyKey === row.id}
                  onClick={() => void waiveLateCancel(row.id)}
                  className="border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
                >
                  {busyKey === row.id ? 'Refunding…' : 'Waive fee'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
