import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useCalendarFeedToken(enabled: boolean) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) {
      setToken(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('ensure_my_calendar_feed_token')

    if (rpcError) {
      if (
        rpcError.message.includes('Could not find the function') ||
        rpcError.message.includes('calendar_feed_tokens')
      ) {
        setError('Run supabase/35-calendar-feed.sql in the Supabase SQL Editor, then try again.')
      } else {
        setError(rpcError.message)
      }
      setToken(null)
      setLoading(false)
      return
    }

    setToken(typeof data === 'string' ? data : null)
    setLoading(false)
  }, [enabled])

  const rotate = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('rotate_my_calendar_feed_token')
    if (rpcError) {
      setError(rpcError.message)
      return null
    }
    const next = typeof data === 'string' ? data : null
    setToken(next)
    return next
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { token, loading, error, reload: load, rotate, setError }
}
