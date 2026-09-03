import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  loadDisplayTimezone,
  persistDisplayTimezone,
  resolveDisplayTimezone,
} from './timezoneUtils'

type AdminTimezoneContextValue = {
  timeZone: string
  setTimeZone: (timeZone: string) => void
}

const AdminTimezoneContext = createContext<AdminTimezoneContextValue | null>(null)

type ProviderProps = {
  profileDisplayTimezone?: string | null
  children: ReactNode
}

export function AdminTimezoneProvider({ profileDisplayTimezone, children }: ProviderProps) {
  const [timeZone, setTimeZoneState] = useState(() =>
    resolveDisplayTimezone(profileDisplayTimezone),
  )

  useEffect(() => {
    if (profileDisplayTimezone) {
      setTimeZoneState(resolveDisplayTimezone(profileDisplayTimezone))
    }
  }, [profileDisplayTimezone])

  const value = useMemo(
    () => ({
      timeZone,
      setTimeZone: (next: string) => {
        setTimeZoneState(next)
        void persistDisplayTimezone(next).catch(() => {
          // localStorage still updated inside persistDisplayTimezone
        })
      },
    }),
    [timeZone],
  )

  return <AdminTimezoneContext.Provider value={value}>{children}</AdminTimezoneContext.Provider>
}

export function useAdminTimezone() {
  const context = useContext(AdminTimezoneContext)
  if (!context) {
    return {
      timeZone: loadDisplayTimezone(),
      setTimeZone: (next: string) => {
        void persistDisplayTimezone(next).catch(() => {})
      },
    }
  }
  return context
}
