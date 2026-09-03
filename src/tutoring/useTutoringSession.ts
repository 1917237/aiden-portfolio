import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { type Profile, supabase } from '../lib/supabase'

type TutoringSession = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  profileError: string | null
  reloadProfile: () => Promise<void>
}

async function fetchProfile(userId: string): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()

  if (error) {
    return {
      profile: null,
      error:
        error.code === 'PGRST116'
          ? 'No profile found for this account. Ask your tutor to finish account setup.'
          : error.message,
    }
  }

  return { profile: data as Profile, error: null }
}

export function useTutoringSession(): TutoringSession {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const reloadProfile = useCallback(async () => {
    if (!session?.user) return
    const result = await fetchProfile(session.user.id)
    setProfile(result.profile)
    setProfileError(result.error)
  }, [session?.user])

  useEffect(() => {
    let active = true

    async function init() {
      const { data, error } = await supabase.auth.getSession()
      if (!active) return

      if (error) {
        setProfileError(error.message)
        setLoading(false)
        return
      }

      const nextSession = data.session
      setSession(nextSession)

      if (nextSession?.user) {
        const result = await fetchProfile(nextSession.user.id)
        if (!active) return
        setProfile(result.profile)
        setProfileError(result.error)
      } else {
        setProfile(null)
        setProfileError(null)
      }

      setLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void (async () => {
        if (!active) return
        setSession(nextSession)

        if (nextSession?.user) {
          const result = await fetchProfile(nextSession.user.id)
          if (!active) return
          setProfile(result.profile)
          setProfileError(result.error)
        } else {
          setProfile(null)
          setProfileError(null)
        }

        setLoading(false)
      })()
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return { session, profile, loading, profileError, reloadProfile }
}
