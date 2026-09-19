import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCredits } from '../../tutoring/format'
import { centsToLessonCredits, formatLessonCredits } from '../../tutoring/lessonCredits'
import { supabase } from '../../lib/supabase'

const HISTORY_FETCH_LIMIT = 30
const REQUESTS_FETCH_LIMIT = 5
/** Roughly ten rows visible before scrolling. */
const HISTORY_VISIBLE_ROWS = 10

type CreditHistoryRow = {
  id: string
  amount_cents: number
  kind: string
  description: string
  created_at: string
}

type CreditRequest = {
  id: string
  amount_cents: number
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

type Props = {
  studentId: string
  classRateCents: number
  refreshKey?: number
}

function formatHistoryTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function requestStatusLabel(status: CreditRequest['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Declined'
  return 'Pending'
}

function requestStatusClass(status: CreditRequest['status']) {
  if (status === 'approved') return 'border-green-200 bg-green-50 text-green-900'
  if (status === 'rejected') return 'border-line bg-bg-elevated/60 text-ink-muted'
  return 'border-amber-200 bg-amber-50 text-amber-950'
}

function formatRequestDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function StudentCreditHistory({ studentId, classRateCents, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<CreditHistoryRow[]>([])
  const [requests, setRequests] = useState<CreditRequest[]>([])
  const [loading, setLoading] = useState(true)
  const hasLoadedOnceRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true)
    setError(null)

    const [historyResult, requestsResult] = await Promise.all([
      supabase.rpc('get_my_credit_history', { p_limit: HISTORY_FETCH_LIMIT }),
      supabase
        .from('credit_requests')
        .select('id, amount_cents, note, status, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(REQUESTS_FETCH_LIMIT),
    ])

    if (historyResult.error) {
      if (
        historyResult.error.message.includes('get_my_credit_history') ||
        historyResult.error.message.includes('credit_ledger')
      ) {
        setRows([])
      } else {
        setError(historyResult.error.message)
        hasLoadedOnceRef.current = true
        setLoading(false)
        return
      }
    } else {
      setRows((historyResult.data ?? []) as CreditHistoryRow[])
    }

    if (requestsResult.error) {
      if (!requestsResult.error.message.includes('credit_requests')) {
        setError(requestsResult.error.message)
      } else {
        setRequests([])
      }
    } else {
      setRequests((requestsResult.data ?? []) as CreditRequest[])
    }

    hasLoadedOnceRef.current = true
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (loading && !hasLoadedOnceRef.current) {
    return <p className="text-sm text-ink-muted">Loading credit activity…</p>
  }

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>
  }

  const hasRequests = requests.length > 0
  const hasHistory = rows.length > 0

  if (!hasRequests && !hasHistory) {
    return (
      <p className="text-sm text-ink-muted">
        No credit activity yet. New bookings and payments will show up here.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {hasRequests ? (
        <div>
          <p className="text-sm font-semibold text-ink-muted">Your requests</p>
          <ul className="mt-2 space-y-2">
            {requests.map((request) => (
              <li
                key={request.id}
                className={`border px-3 py-2 text-sm ${requestStatusClass(request.status)}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {formatLessonCredits(centsToLessonCredits(request.amount_cents, classRateCents))}
                    <span className="font-normal text-ink-muted">
                      {' '}
                      ({formatCredits(request.amount_cents)})
                    </span>
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {requestStatusLabel(request.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {request.note ? `${request.note} · ` : ''}
                  {formatRequestDate(request.created_at)}
                  {request.status === 'pending' ? ' · waiting for tutor' : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasHistory ? (
        <div>
          <p className="text-sm font-semibold text-ink-muted">Activity</p>
          {rows.length > HISTORY_VISIBLE_ROWS ? (
            <p className="mt-1 text-xs text-ink-muted">
              Showing latest {rows.length} entries. scroll for more.
            </p>
          ) : null}
          <div
            className="mt-2 overflow-y-auto border border-line bg-white"
            style={{ maxHeight: `calc(${HISTORY_VISIBLE_ROWS} * 3.25rem)` }}
          >
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const credits = centsToLessonCredits(row.amount_cents, classRateCents)
                const isPositive = row.amount_cents > 0
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{row.description}</p>
                      <time className="text-xs text-ink-muted">{formatHistoryTime(row.created_at)}</time>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-semibold ${
                          isPositive
                            ? 'text-green-700'
                            : row.amount_cents < 0
                              ? 'text-red-700'
                              : 'text-ink'
                        }`}
                      >
                        {isPositive ? '+' : ''}
                        {formatLessonCredits(credits)}
                      </p>
                      <details className="text-xs text-ink-muted">
                        <summary className="cursor-pointer hover:text-ink">Dollars</summary>
                        <span>
                          {isPositive ? '+' : ''}
                          {formatCredits(row.amount_cents)}
                        </span>
                      </details>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}
