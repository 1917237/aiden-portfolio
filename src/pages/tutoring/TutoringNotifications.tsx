import { Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useStudentNotifications } from '../../tutoring/useStudentNotifications'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import { AdminTimezoneProvider } from '../../tutoring/AdminTimezoneContext'
import { AdminNav } from './AdminNav'
import { StudentNav } from './StudentNav'

function formatNotificationTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TutoringNotifications() {
  const { session, profile, loading, profileError } = useTutoringSession()
  const isSignedInUser = Boolean(profile)
  const {
    notifications,
    loading: notifLoading,
    error,
    markAllRead,
    deleteNotification,
    deleteAllNotifications,
  } = useStudentNotifications(isSignedInUser)

  useEffect(() => {
    if (!isSignedInUser) return
    void markAllRead()
    // Mark unread as read once when opening this tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally once per visit
  }, [isSignedInUser])

  if (!loading && !session) {
    return <Navigate to="/tutoring/login" replace />
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-5 py-20 text-ink-muted">Loading…</div>
  }

  if (profileError || !profile) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-20 text-red-700">
        {profileError ?? 'Could not load your account.'}
      </div>
    )
  }

  const isAdmin = profile.role === 'admin'

  const content = (
    <div
      className={`w-full px-4 py-6 md:px-6 ${isAdmin ? 'max-w-none' : 'mx-auto max-w-6xl md:py-20'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Notifications
          </h1>
          <p className="mt-3 text-ink-muted">
            {isAdmin
              ? 'New student bookings and other updates.'
              : 'Class cancellations, weekly skips, and other updates.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <AdminNav current="notifications" />
          ) : (
            <StudentNav current="notifications" />
          )}
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

      {!notifLoading && notifications.length > 0 ? (
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Delete all notifications?')) return
              void deleteAllNotifications()
            }}
            className="border border-line px-3 py-1.5 text-sm font-semibold text-ink-muted hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          >
            Delete all
          </button>
        </div>
      ) : null}

      {notifLoading ? (
        <p className="mt-8 text-ink-muted">Loading notifications…</p>
      ) : notifications.length === 0 ? (
        <p className="mt-8 text-ink-muted">No notifications yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border border-line bg-white">
          {notifications.map((item) => (
            <li key={item.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold text-ink">{item.title}</h2>
                    <time className="text-xs text-ink-muted">
                      {formatNotificationTime(item.created_at)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteNotification(item.id)}
                  className="shrink-0 border border-line px-2.5 py-1 text-xs font-semibold text-ink-muted hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  if (isAdmin) {
    return (
      <AdminTimezoneProvider profileDisplayTimezone={profile.display_timezone}>
        {content}
      </AdminTimezoneProvider>
    )
  }

  return content
}
