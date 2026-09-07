import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCredits, formatSlotRange } from '../../tutoring/format'
import { supabase } from '../../lib/supabase'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'

type ExceptionRow = {
  id: string
  charged_cents: number
  late_fee_status: 'held' | 'waive_requested' | string
  waive_request_reason: string | null
  waive_requested_at: string | null
  student_name: string
  start_time: string
  end_time: string
}

type Props = {
  refreshKey?: number
  onChanged?: () => void
}

function unwrapSlot(raw: unknown) {
  return (Array.isArray(raw) ? raw[0] : raw) as
    | { start_time: string; end_time: string }
    | null
}

function unwrapProfile(raw: unknown) {
  const profile = (Array.isArray(raw) ? raw[0] : raw) as { full_name: string } | null
  return profile?.full_name ?? 'Student'
}

export function AdminLateCancelExceptions({ refreshKey = 0, onChanged }: Props) {
  const { timeZone } = useAdminTimezone()
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true)
    setError(null)

    const { data, error: queryError } = await supabase
      .from('bookings')
      .select(
        'id, charged_cents, late_fee_status, waive_request_reason, waive_requested_at, availability_slots(start_time, end_time), profiles!bookings_student_id_fkey(full_name)',
      )
      .eq('status', 'cancelled')
      .gt('charged_cents', 0)
      .in('late_fee_status', ['held', 'waive_requested'])
      .order('waive_requested_at', { ascending: false, nullsFirst: false })

    if (queryError) {
      setError(
        queryError.message.includes('late_fee_status')
          ? 'Run the Late-cancel waive section at the bottom of supabase/baseline/baseline.sql in the Supabase SQL Editor first.'
          : queryError.message,
      )
      setRows([])
      hasLoadedRef.current = true
      setLoading(false)
      return
    }

    const next: ExceptionRow[] = []
    for (const row of data ?? []) {
      const slot = unwrapSlot(row.availability_slots)
      if (!slot) continue
      const charged = typeof row.charged_cents === 'number' ? row.charged_cents : 0
      if (charged <= 0) continue
      next.push({
        id: row.id as string,
        charged_cents: charged,
        late_fee_status: (row.late_fee_status as string) ?? 'held',
        waive_request_reason: (row.waive_request_reason as string | null) ?? null,
        waive_requested_at: (row.waive_requested_at as string | null) ?? null,
        student_name: unwrapProfile(row.profiles),
        start_time: slot.start_time,
        end_time: slot.end_time,
      })
    }

    next.sort((a, b) => {
      const aAsk = a.late_fee_status === 'waive_requested' ? 0 : 1
      const bAsk = b.late_fee_status === 'waive_requested' ? 0 : 1
      if (aAsk !== bAsk) return aAsk - bAsk
      return b.start_time.localeCompare(a.start_time)
    })

    setRows(next)
    hasLoadedRef.current = true
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function waive(id: string) {
    if (busyId) return
    setBusyId(id)
    setError(null)
    setMessage(null)

    const { error: rpcError } = await supabase.rpc('admin_waive_late_cancel', {
      p_booking_id: id,
    })

    setBusyId(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setMessage('Late fee waived — credits refunded.')
    await load()
    onChanged?.()
  }

  async function keep(id: string) {
    if (busyId) return
    setBusyId(id)
    setError(null)
    setMessage(null)

    const { error: rpcError } = await supabase.rpc('admin_keep_late_cancel_fee', {
      p_booking_id: id,
    })

    setBusyId(null)

    if (rpcError) {
      setError(
        rpcError.message.includes('admin_keep_late_cancel_fee')
          ? 'Run the Late-cancel waive section at the bottom of supabase/baseline/baseline.sql in the Supabase SQL Editor first.'
          : rpcError.message,
      )
      return
    }

    setMessage('Late fee kept — removed from inbox.')
    await load()
    onChanged?.()
  }

  if (loading && !hasLoadedRef.current) {
    return <p className="text-sm text-ink-muted">Loading late cancels…</p>
  }

  if (rows.length === 0 && !error) {
    return null
  }

  return (
    <section>
      <h2 className="font-display text-2xl font-semibold tracking-tight">Late cancel exceptions</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Credits held from cancellations inside 12 hours. Waive to refund, or keep the fee and clear
        the item.
      </p>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-sage-deep">{message}</p> : null}

      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const asked = row.late_fee_status === 'waive_requested'
          return (
            <li
              key={row.id}
              className={`border px-4 py-3 ${
                asked ? 'border-amber-300 bg-amber-50/60' : 'border-red-200 bg-red-50/40'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{row.student_name}</p>
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 ${
                        asked ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {asked ? 'Waive requested' : 'Late cancel'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatSlotRange(row.start_time, row.end_time, timeZone)} ·{' '}
                    {formatCredits(row.charged_cents)} held
                  </p>
                  {asked && row.waive_request_reason ? (
                    <p className="mt-2 text-sm text-ink">
                      Reason: <span className="text-ink-muted">{row.waive_request_reason}</span>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void keep(row.id)}
                    className="border border-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
                  >
                    {busyId === row.id ? 'Saving…' : 'Keep fee'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void waive(row.id)}
                    className="bg-sage-deep px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {busyId === row.id ? 'Refunding…' : 'Waive fee'}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
