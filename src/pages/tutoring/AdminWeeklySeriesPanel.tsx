import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDurationLabel } from '../../tutoring/bookingDurationConfig'
import { formatSlotRange } from '../../tutoring/format'
import { supabase } from '../../lib/supabase'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'

type WeeklySeriesRow = {
  id: string
  student_id: string
  duration_minutes: number
  pay_later: boolean
  rolling: boolean
  active: boolean
  profiles: { full_name: string } | { full_name: string }[] | null
}

type SeriesBooking = {
  id: string
  start_time: string
  end_time: string
}

type Props = {
  refreshKey?: number
}

export function AdminWeeklySeriesPanel({ refreshKey = 0 }: Props) {
  const { timeZone } = useAdminTimezone()
  const [series, setSeries] = useState<WeeklySeriesRow[]>([])
  const [nextBySeries, setNextBySeries] = useState<Record<string, SeriesBooking>>({})
  const [loading, setLoading] = useState(true)
  const hasLoadedOnceRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true)
    setError(null)

    const { data, error: seriesError } = await supabase
      .from('weekly_series')
      .select('id, student_id, duration_minutes, pay_later, rolling, active, profiles!weekly_series_student_id_fkey(full_name)')
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (seriesError) {
      if (seriesError.message.includes('weekly_series')) {
        setSeries([])
        hasLoadedOnceRef.current = true
        setLoading(false)
        return
      }
      setError(seriesError.message)
      hasLoadedOnceRef.current = true
      setLoading(false)
      return
    }

    const rows = (data ?? []) as WeeklySeriesRow[]
    setSeries(rows)

    if (rows.length === 0) {
      setNextBySeries({})
      hasLoadedOnceRef.current = true
      setLoading(false)
      return
    }

    const seriesIds = rows.map((row) => row.id)
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, series_id, duration_minutes, availability_slots(start_time, end_time)')
      .in('series_id', seriesIds)
      .eq('status', 'booked')

    if (bookingsError) {
      setError(bookingsError.message)
      hasLoadedOnceRef.current = true
      setLoading(false)
      return
    }

    const now = Date.now()
    const nextMap: Record<string, SeriesBooking> = {}
    for (const row of bookings ?? []) {
      const seriesId = row.series_id as string | null
      if (!seriesId) continue
      const slotRaw = row.availability_slots
      const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as
        | { start_time: string; end_time: string }
        | null
      if (!slot?.start_time) continue
      if (new Date(slot.start_time).getTime() < now) continue
      const duration = (row.duration_minutes as number) ?? 50
      const end =
        slot.end_time ??
        new Date(new Date(slot.start_time).getTime() + duration * 60_000).toISOString()
      const existing = nextMap[seriesId]
      if (!existing || slot.start_time < existing.start_time) {
        nextMap[seriesId] = { id: row.id as string, start_time: slot.start_time, end_time: end }
      }
    }

    setNextBySeries(nextMap)
    hasLoadedOnceRef.current = true
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function stopSeries(seriesId: string) {
    if (
      !window.confirm(
        'Stop this weekly series now? All upcoming classes in the series will be cancelled.',
      )
    ) {
      return
    }

    setBusyId(seriesId)
    const { error: rpcError } = await supabase.rpc('stop_my_weekly_series', {
      p_series_id: seriesId,
      p_mode: 'now',
      p_stop_on_date: null,
      p_stop_timezone: null,
    })
    setBusyId(null)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    void load()
  }

  if (loading && !hasLoadedOnceRef.current) {
    return <p className="text-sm text-ink-muted">Loading weekly series…</p>
  }

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>
  }

  if (series.length === 0) {
    return <p className="text-sm text-ink-muted">No active weekly series.</p>
  }

  return (
    <ul className="space-y-2">
      {series.map((item) => {
        const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles
        const next = nextBySeries[item.id]
        const busy = busyId === item.id
        return (
          <li key={item.id} className="border border-line px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{profile?.full_name ?? 'Student'}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {formatDurationLabel(item.duration_minutes)}
                  {item.pay_later ? ' · pay later' : ''}
                  {item.rolling ? ' · rolling' : ''}
                </p>
                {next ? (
                  <p className="mt-1 text-sm">
                    Next: {formatSlotRange(next.start_time, next.end_time, timeZone)}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-ink-muted">No upcoming class booked yet.</p>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void stopSeries(item.id)}
                className="border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-60"
              >
                {busy ? 'Stopping…' : 'Stop series'}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
