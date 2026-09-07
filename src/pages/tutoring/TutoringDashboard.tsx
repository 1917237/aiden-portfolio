import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { TUTORING_BRAND_NAME } from '../../tutoring/brand'
import { maintainRollingWeeklySeries } from '../../tutoring/maintainRollingWeekly'
import { AdminTimezoneProvider } from '../../tutoring/AdminTimezoneContext'
import { loadDisplayTimezone, persistDisplayTimezone, resolveDisplayTimezone } from '../../tutoring/timezoneUtils'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import { AdminNav } from './AdminNav'
import { AdminTools } from './AdminTools'
import { StudentBalanceChip } from './StudentBalanceChip'
import { StudentBooking } from './StudentBooking'
import { StudentClassesSection } from './StudentClassesSection'
import { StudentCreditsPanel } from './StudentCreditsPanel'
import { StudentNav } from './StudentNav'
import { StudentSignedInMenu } from './StudentSignedInMenu'
import { StudentLessonModal } from './StudentLessonModal'
import type { StudentLesson } from './StudentLessonsCalendar'
import { StudentUpcomingPanel } from './StudentUpcomingPanel'

export function TutoringDashboard() {
  const { session, profile, loading, profileError, reloadProfile } = useTutoringSession()
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [timeZone, setTimeZone] = useState(loadDisplayTimezone)
  const [selectedLesson, setSelectedLesson] = useState<StudentLesson | null>(null)

  useEffect(() => {
    if (profile?.full_name) setDisplayName(profile.full_name)
  }, [profile?.full_name])

  useEffect(() => {
    if (profile?.role === 'student' || profile?.role === 'admin') {
      setTimeZone(resolveDisplayTimezone(profile.display_timezone))
    }
  }, [profile?.display_timezone, profile?.role])

  useEffect(() => {
    if (!profile?.id || profile.role !== 'student') return
    let cancelled = false
    void (async () => {
      await maintainRollingWeeklySeries(profile.id)
      if (cancelled) return
      await reloadProfile()
      if (cancelled) return
      setScheduleRefreshKey((value) => value + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [profile?.id, profile?.role, reloadProfile])

  function handleStudentScheduleChanged() {
    void reloadProfile()
    setScheduleRefreshKey((value) => value + 1)
  }

  function handleTimezoneChange(nextTimeZone: string) {
    setTimeZone(nextTimeZone)
    void persistDisplayTimezone(nextTimeZone).catch(() => {
      // localStorage still updated inside persistDisplayTimezone
    })
  }

  if (!loading && !session) {
    return <Navigate to="/tutoring/login" replace />
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-20 text-ink-muted">Loading…</div>
    )
  }

  if (profileError || !profile) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-red-700">{profileError ?? 'Could not load your account.'}</p>
        <button
          type="button"
          onClick={() => void reloadProfile()}
          className="tutoring-btn mt-4"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="tutoring-btn mt-4 ml-3"
        >
          Sign out
        </button>
      </div>
    )
  }

  const isAdmin = profile.role === 'admin'

  if (isAdmin) {
    return (
      <AdminTimezoneProvider profileDisplayTimezone={profile.display_timezone}>
        <div className="w-full max-w-none px-4 py-6 md:px-6">
          <div className="tutoring-topbar tutoring-enter">
            <div>
              <p className="tutoring-eyebrow">{TUTORING_BRAND_NAME}</p>
              <h1 className="tutoring-title">Admin dashboard</h1>
              <p className="mt-2 text-sm text-ink-muted">
                Signed in as <strong className="text-ink">{profile.full_name}</strong>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AdminNav current="dashboard" />
              <button
                type="button"
                onClick={() => void supabase.auth.signOut()}
                className="tutoring-btn"
              >
                Sign out
              </button>
            </div>
          </div>
          <AdminTools onUpdated={() => void reloadProfile()} />
        </div>
      </AdminTimezoneProvider>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="tutoring-topbar tutoring-enter">
        <div>
          <p className="tutoring-eyebrow">{TUTORING_BRAND_NAME}</p>
          <h1 className="tutoring-title">My schedule</h1>
          <StudentSignedInMenu
            fullName={displayName || profile.full_name}
            onSaved={(nextName) => {
              setDisplayName(nextName)
              void reloadProfile()
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StudentBalanceChip
            balanceCents={profile.credit_balance_cents}
            classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
          />
          <StudentNav current="schedule" />
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="tutoring-btn"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Class ops first: upcoming → book → calendar; credits below */}
      <div className="tutoring-enter tutoring-enter-delay-1">
        <StudentUpcomingPanel
          studentId={profile.id}
          timeZone={timeZone}
          refreshKey={scheduleRefreshKey}
          onChanged={handleStudentScheduleChanged}
          onSelectLesson={setSelectedLesson}
        />
      </div>

      <div className="tutoring-enter tutoring-enter-delay-2">
        <StudentBooking
          creditBalance={profile.credit_balance_cents}
          classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
          onBooked={handleStudentScheduleChanged}
          timeZone={timeZone}
          onTimeZoneChange={handleTimezoneChange}
        />
      </div>

      <div className="tutoring-enter tutoring-enter-delay-3">
        <StudentClassesSection
          studentId={profile.id}
          timeZone={timeZone}
          refreshKey={scheduleRefreshKey}
          onSelectLesson={setSelectedLesson}
        />
      </div>

      <div className="tutoring-enter tutoring-enter-delay-4">
        <StudentCreditsPanel
          studentId={profile.id}
          creditBalance={profile.credit_balance_cents}
          classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
          refreshKey={scheduleRefreshKey}
        />
      </div>

      {selectedLesson ? (
        <StudentLessonModal
          lesson={selectedLesson}
          timeZone={timeZone}
          classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
          onClose={() => setSelectedLesson(null)}
          onSaved={handleStudentScheduleChanged}
        />
      ) : null}
    </div>
  )
}
