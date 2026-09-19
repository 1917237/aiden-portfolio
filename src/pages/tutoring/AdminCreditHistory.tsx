import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCredits } from '../../tutoring/format'
import { centsToLessonCredits, formatLessonCredits } from '../../tutoring/lessonCredits'
import { supabase } from '../../lib/supabase'

const HISTORY_FETCH_LIMIT = 30
const HISTORY_VISIBLE_ROWS = 10

type CreditHistoryRow = {
  id: string
  amount_cents: number
  kind: string
  description: string
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

export function AdminCreditHistory({ studentId, classRateCents, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<CreditHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const hasLoadedOnceRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('get_student_credit_history', {
      p_student_id: studentId,
      p_limit: HISTORY_FETCH_LIMIT,
    })

    if (rpcError) {
      if (
        rpcError.message.includes('get_student_credit_history') ||
        rpcError.message.includes('credit_ledger')
      ) {
        setRows([])
      } else {
        setError(rpcError.message)
        hasLoadedOnceRef.current = true
        setLoading(false)
        return
      }
    } else {
      setRows((data ?? []) as CreditHistoryRow[])
    }

    hasLoadedOnceRef.current = true
    setLoading(false)
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (loading && !hasLoadedOnceRef.current) {
    return <p className="text-sm text-ink-muted">Loading credit history…</p>
  }

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>
  }

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">No credit activity yet.</p>
  }

  return (
    <div>
      {rows.length > HISTORY_VISIBLE_ROWS ? (
        <p className="mb-2 text-xs text-ink-muted">
          Showing latest {rows.length} entries. scroll for more.
        </p>
      ) : null}
      <div
        className="overflow-y-auto border border-line bg-white"
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
                  <p className="text-xs text-ink-muted">
                    {isPositive ? '+' : ''}
                    {formatCredits(row.amount_cents)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
