import { Navigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCredits } from '../../tutoring/format'
import {
  buildChartPoints,
  computeInsightTotals,
  formatHours,
  toCumulativePoints,
  type CompletedLesson,
  type InsightRange,
} from '../../tutoring/insightsUtils'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import { AdminTimezoneProvider } from '../../tutoring/AdminTimezoneContext'
import { AdminNav } from './AdminNav'
import { IncomeChart } from './IncomeChart'

const RANGES: { id: InsightRange; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: 'Month' },
  { id: '1y', label: 'Year' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'All time' },
]

type StatCard = {
  value: string
  label: string
}

export function TutoringInsights() {
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
      <TutoringInsightsPage />
    </AdminTimezoneProvider>
  )
}

function TutoringInsightsPage() {
  const location = useLocation()
  const { profile } = useTutoringSession()
  const [range, setRange] = useState<InsightRange>('all')
  const [lessons, setLessons] = useState<CompletedLesson[]>([])
  const [totalStudents, setTotalStudents] = useState(0)
  const [dataLoading, setDataLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInsights = useCallback(async () => {
    if (!hasLoaded) setDataLoading(true)
    setError(null)

    const [bookingsResult, studentsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('charged_cents, completed_at, availability_slots(start_time, end_time)')
        .eq('status', 'completed'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    ])

    let bookingRows: Array<{
      charged_cents: number | null
      completed_at?: string | null
      availability_slots: unknown
    }> | null = bookingsResult.data
    let bookingsError = bookingsResult.error

    if (
      bookingsError?.message.includes('completed_at') ||
      bookingsError?.message.includes('column')
    ) {
      const fallback = await supabase
        .from('bookings')
        .select('charged_cents, availability_slots(start_time, end_time)')
        .eq('status', 'completed')
      bookingRows = fallback.data
      bookingsError = fallback.error
    }

    if (bookingsError || studentsResult.error) {
      setError(bookingsError?.message ?? studentsResult.error?.message ?? 'Failed to load')
      setDataLoading(false)
      return
    }

    const completed: CompletedLesson[] = []
    for (const row of bookingRows ?? []) {
      const slotRaw = row.availability_slots
      const slot = (Array.isArray(slotRaw) ? slotRaw[0] : slotRaw) as
        | { start_time: string; end_time: string }
        | null
      if (!slot?.start_time || !slot.end_time) continue
      completed.push({
        chargedCents: (row.charged_cents as number | null) ?? 0,
        startTime: slot.start_time,
        endTime: slot.end_time,
        completedAt: row.completed_at ?? null,
      })
    }

    setLessons(completed)
    setTotalStudents(studentsResult.count ?? 0)
    setHasLoaded(true)
    setDataLoading(false)
  }, [hasLoaded])

  useEffect(() => {
    if (profile?.role === 'admin') {
      void loadInsights()
    }
  }, [loadInsights, location.pathname, profile?.role])

  const chartPoints = useMemo(
    () => toCumulativePoints(buildChartPoints(lessons, range)),
    [lessons, range],
  )
  const totals = useMemo(
    () => computeInsightTotals(lessons, totalStudents, range),
    [lessons, totalStudents, range],
  )

  const journeyStats = useMemo(
    () => computeInsightTotals(lessons, totalStudents, 'all'),
    [lessons, totalStudents],
  )

  const journeySubtitle = journeyStats.journeyStart
    ? `See what you've accomplished since you started in ${journeyStats.journeyStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`
    : 'Complete your first lesson to start tracking your journey.'

  const statCards: StatCard[] = [
    { value: formatHours(journeyStats.hoursTaught), label: 'Hours taught' },
    { value: String(journeyStats.lessons), label: 'Lessons taught' },
    { value: String(journeyStats.totalStudents), label: 'Total students' },
    { value: formatCredits(journeyStats.totalEarningsCents), label: 'Total earnings' },
  ]

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Insights</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminNav current="insights" />
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

      <div className="mx-auto mt-6 max-w-5xl space-y-8">
        <section className="border border-line bg-white p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink-muted">Income earned</p>
              <p className="mt-2 font-display text-4xl font-semibold md:text-5xl">
                {!hasLoaded && dataLoading ? '…' : formatCredits(totals.incomeCents)}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                Total for the selected range. The chart shows cumulative income over time.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {RANGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRange(item.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    range === item.id
                      ? 'border-sage-deep bg-sage/20 text-sage-deep'
                      : 'border-line text-ink-muted hover:bg-bg-elevated hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            {!hasLoaded && dataLoading ? (
              <p className="py-16 text-center text-ink-muted">Loading chart…</p>
            ) : (
              <IncomeChart key={`${range}-${chartPoints.map((point) => point.incomeCents).join(',')}`} points={chartPoints} />
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-3xl font-semibold">Your tutoring journey</h2>
          <p className="mt-2 text-ink-muted">{journeySubtitle}</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {statCards.map((card) => (
              <div key={card.label} className="border border-line bg-white p-5">
                <p className="font-display text-4xl font-semibold">{card.value}</p>
                <p className="mt-1 text-sm text-ink-muted">{card.label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
