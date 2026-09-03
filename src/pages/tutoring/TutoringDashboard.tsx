import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DEFAULT_CLASS_RATE_CENTS } from '../../tutoring/config'
import { maintainRollingWeeklySeries } from '../../tutoring/maintainRollingWeekly'
import { AdminTimezoneProvider } from '../../tutoring/AdminTimezoneContext'
import { loadDisplayTimezone, persistDisplayTimezone, resolveDisplayTimezone } from '../../tutoring/timezoneUtils'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import { AdminNav } from './AdminNav'
import { AdminTools } from './AdminTools'
import { StudentBooking } from './StudentBooking'
import { StudentClassesSection } from './StudentClassesSection'
import { StudentCreditsPanel } from './StudentCreditsPanel'
import { StudentNav } from './StudentNav'
import { StudentSignedInMenu } from './StudentSignedInMenu'
import { StudentLessonModal } from './StudentLessonModal'
import type { StudentLesson } from './StudentLessonsCalendar'
import { StudentUpcomingPanel } from './StudentUpcomingPanel'
import { TimesInTimezoneLabel } from './TimesInTimezoneLabel'
import { TimezoneSelect } from './TimezoneSelect'

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
      <div className="mx-auto max-w-6xl px-5 py-20 text-ink-muted">
        Loading…
      </div>
    )
  }

  if (profileError || !profile) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-red-700">{profileError ?? 'Could not load your account.'}</p>
        <button
          type="button"
          onClick={() => void reloadProfile()}
          className="mt-4 border border-line px-3 py-1.5 text-sm font-semibold"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="mt-4 ml-3 border border-line px-3 py-1.5 text-sm font-semibold"
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
        <div className="w-full px-4 py-6 md:px-6 max-w-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
              <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Admin dashboard</h1>
              <p className="mt-3 text-ink-muted">
                Signed in as <strong className="text-ink">{profile.full_name}</strong> (admin)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AdminNav current="dashboard" />
              <button
                type="button"
                onClick={() => void supabase.auth.signOut()}
                className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
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
    <div className="mx-auto max-w-6xl w-full px-4 py-6 md:px-6 md:py-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">My schedule</h1>
          <StudentSignedInMenu
            fullName={displayName || profile.full_name}
            onSaved={(nextName) => {
              setDisplayName(nextName)
              void reloadProfile()
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <StudentNav current="schedule" />
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-end gap-1">
        <TimesInTimezoneLabel timeZone={timeZone} />
        <TimezoneSelect value={timeZone} onChange={handleTimezoneChange} />
      </div>

      <StudentCreditsPanel
        studentId={profile.id}
        creditBalance={profile.credit_balance_cents}
        classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
        refreshKey={scheduleRefreshKey}
      />

      <StudentUpcomingPanel
        studentId={profile.id}
        timeZone={timeZone}
        refreshKey={scheduleRefreshKey}
        onChanged={handleStudentScheduleChanged}
        onSelectLesson={setSelectedLesson}
      />

      <StudentBooking
        creditBalance={profile.credit_balance_cents}
        classRateCents={profile.class_rate_cents ?? DEFAULT_CLASS_RATE_CENTS}
        onBooked={handleStudentScheduleChanged}
        timeZone={timeZone}
        onTimeZoneChange={handleTimezoneChange}
      />

      <StudentClassesSection
        studentId={profile.id}
        timeZone={timeZone}
        refreshKey={scheduleRefreshKey}
        onSelectLesson={setSelectedLesson}
      />

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
