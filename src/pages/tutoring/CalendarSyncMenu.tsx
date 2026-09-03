import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildIcsCalendar,
  calendarFeedHttpsUrl,
  calendarFeedWebcalUrl,
  downloadIcsFile,
  googleCalendarSubscribeUrl,
  type CalendarIcsEvent,
} from '../../tutoring/calendarIcs'
import { useCalendarFeedToken } from '../../tutoring/useCalendarFeedToken'

type Props = {
  downloadEvents?: CalendarIcsEvent[]
}

export function CalendarSyncMenu({ downloadEvents = [] }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { token, loading, error, rotate, setError } = useCalendarFeedToken(open)

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const feedUrl = useMemo(() => {
    if (!token || !supabaseUrl) return null
    return calendarFeedHttpsUrl(supabaseUrl, token)
  }, [supabaseUrl, token])

  const webcalUrl = feedUrl ? calendarFeedWebcalUrl(feedUrl) : null
  const googleUrl = feedUrl ? googleCalendarSubscribeUrl(feedUrl) : null

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  function handleDownloadSnapshot() {
    if (downloadEvents.length === 0) return
    const ics = buildIcsCalendar(downloadEvents, 'My tutoring lessons')
    downloadIcsFile('my-tutoring-lessons.ics', ics)
  }

  async function handleRotateLink() {
    if (!window.confirm('Create a new subscribe link? Old links in Google Calendar will stop updating.')) {
      return
    }
    setError(null)
    await rotate()
  }

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Calendar sync
        <span className="text-xs text-ink-muted" aria-hidden>
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Calendar sync"
          className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-line bg-white p-4 shadow-lg"
        >
          <p className="text-sm text-ink-muted">
            Add your upcoming lessons to Google or Apple Calendar with reminders.
          </p>

          {loading ? <p className="mt-3 text-sm text-ink-muted">Preparing your link…</p> : null}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

          {!loading && feedUrl ? (
            <div className="mt-3 flex flex-col gap-2">
              {googleUrl ? (
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-line bg-sage px-3 py-2 text-center text-sm font-semibold hover:bg-sage-deep"
                  onClick={() => setOpen(false)}
                >
                  Add to Google Calendar
                </a>
              ) : null}
              {webcalUrl ? (
                <a
                  href={webcalUrl}
                  className="border border-line px-3 py-2 text-center text-sm font-semibold hover:bg-bg-elevated"
                  onClick={() => setOpen(false)}
                >
                  Subscribe in Apple Calendar
                </a>
              ) : null}
              {downloadEvents.length > 0 ? (
                <button
                  type="button"
                  onClick={handleDownloadSnapshot}
                  className="border border-line px-3 py-2 text-sm font-semibold hover:bg-bg-elevated"
                >
                  Download .ics snapshot
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleRotateLink()}
                className="border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-bg-elevated"
              >
                New private link
              </button>
            </div>
          ) : null}

          {!loading && feedUrl ? (
            <details className="mt-3 text-sm text-ink-muted">
              <summary className="cursor-pointer font-medium text-ink">Copy subscribe URL</summary>
              <p className="mt-2 break-all rounded border border-line bg-bg-elevated p-2 font-mono text-xs">
                {feedUrl}
              </p>
            </details>
          ) : null}

          {!loading && !error && !feedUrl ? (
            <p className="mt-3 text-sm text-ink-muted">Could not create a calendar link.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
