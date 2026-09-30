import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

type Status = {
  connected: boolean
  email: string | null
}

async function readFunctionError(fnError: unknown): Promise<string> {
  if (fnError instanceof FunctionsHttpError) {
    try {
      const body = await fnError.context.json()
      if (body && typeof body === 'object' && 'error' in body) {
        return String((body as { error: unknown }).error)
      }
    } catch {
      /* fall through */
    }
  }
  if (fnError && typeof fnError === 'object' && 'message' in fnError) {
    return String((fnError as { message: string }).message)
  }
  return 'Google Calendar request failed'
}

export function GoogleCalendarConnect() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('get_google_calendar_status')
    if (rpcError) {
      setError(
        rpcError.message.includes('get_google_calendar_status')
          ? 'Run supabase/migrations/56-google-calendar-sync.sql in the Supabase SQL Editor first.'
          : rpcError.message,
      )
      return
    }
    const row = (data ?? {}) as { connected?: boolean; email?: string | null }
    setStatus({ connected: Boolean(row.connected), email: row.email ?? null })
  }, [])

  useEffect(() => {
    void loadStatus()

    const params = new URLSearchParams(window.location.search)
    const result = params.get('google')
    if (!result) return
    if (result === 'connected') {
      setMessage('Google Calendar connected. Upcoming lessons are being added now.')
    } else {
      setError(`Google connection failed: ${params.get('reason') ?? 'unknown error'}`)
    }
    params.delete('google')
    params.delete('reason')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [loadStatus])

  async function handleConnect() {
    setBusy(true)
    setError(null)
    const { data, error: fnError } = await supabase.functions.invoke('google-calendar', {
      body: { action: 'auth_url' },
    })
    if (fnError || !data?.url) {
      setBusy(false)
      setError(fnError ? await readFunctionError(fnError) : 'Could not start Google sign in')
      return
    }
    window.location.href = data.url as string
  }

  async function handleSyncNow() {
    setBusy(true)
    setError(null)
    setMessage(null)
    const { data, error: fnError } = await supabase.functions.invoke('google-calendar', {
      body: { action: 'sync_all' },
    })
    setBusy(false)
    if (fnError) {
      setError(await readFunctionError(fnError))
      await loadStatus()
      return
    }
    const synced = Number(data?.synced ?? 0)
    const failed = Number(data?.failed ?? 0)
    setMessage(
      failed > 0
        ? `Synced ${synced} lessons, ${failed} failed. Try again in a minute.`
        : `Synced ${synced} upcoming lessons to Google Calendar.`,
    )
  }

  async function handleDisconnect() {
    if (!window.confirm('Stop sending lesson changes to Google Calendar?')) return
    setBusy(true)
    setError(null)
    setMessage(null)
    const { error: rpcError } = await supabase.rpc('disconnect_google_calendar')
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    await loadStatus()
  }

  return (
    <div className="border border-line bg-white p-4">
      <h3 className="text-sm font-semibold">Instant Google Calendar sync</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Bookings, reschedules and cancellations show up in your Google Calendar within seconds.
        Students are added as guests, so Google updates their calendar and emails them too.
      </p>

      {status?.connected ? (
        <p className="mt-3 text-sm">
          Connected{status.email ? ` as ${status.email}` : ''}.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-green-800">{message}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {status && !status.connected ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConnect()}
            className="border border-line bg-sage px-3 py-2 text-sm font-semibold hover:bg-sage-deep disabled:opacity-60"
          >
            {busy ? 'Opening Google…' : 'Connect Google Calendar'}
          </button>
        ) : null}
        {status?.connected ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSyncNow()}
              className="border border-line px-3 py-2 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
            >
              {busy ? 'Syncing…' : 'Sync upcoming lessons now'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDisconnect()}
              className="border border-line px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-bg-elevated disabled:opacity-60"
            >
              Disconnect
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
