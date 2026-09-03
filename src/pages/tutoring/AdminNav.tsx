import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'
import { useStudentNotifications } from '../../tutoring/useStudentNotifications'
import { TimezoneSelect } from './TimezoneSelect'

type Props = {
  current: 'dashboard' | 'calendar' | 'students' | 'insights' | 'notifications'
}

export function AdminNav({ current }: Props) {
  const { unreadCount, reload, markAllRead } = useStudentNotifications(true)
  const { timeZone, setTimeZone } = useAdminTimezone()

  useEffect(() => {
    if (current === 'notifications') {
      void markAllRead()
      return
    }
    void reload()
  }, [current, markAllRead, reload])

  const linkClass = (page: Props['current']) =>
    `relative border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated ${
      current === page ? 'bg-bg-elevated' : ''
    }`

  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/tutoring/dashboard" className={linkClass('dashboard')}>
        Dashboard
      </Link>
      <Link to="/tutoring/calendar" className={linkClass('calendar')}>
        Calendar
      </Link>
      <Link to="/tutoring/students" className={linkClass('students')}>
        Students
      </Link>
      <Link to="/tutoring/insights" className={linkClass('insights')}>
        Insights
      </Link>
      <Link to="/tutoring/notifications" className={linkClass('notifications')}>
        Notifications
        {unreadCount > 0 && current !== 'notifications' ? (
          <span
            className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Link>
      <TimezoneSelect value={timeZone} onChange={setTimeZone} />
    </div>
  )
}
