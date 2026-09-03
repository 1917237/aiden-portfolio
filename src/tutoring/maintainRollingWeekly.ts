import { supabase } from '../lib/supabase'

let maintainInFlight: Promise<void> | null = null

/**
 * Keep this student's active rolling weekly series topped up (server-side).
 * A Supabase cron also runs maintain_all_rolling_weekly every 6 hours
 * (see supabase/27-maintain-rolling-cron.sql).
 */
export async function maintainRollingWeeklySeries(_studentId: string): Promise<void> {
  if (maintainInFlight) return maintainInFlight
  maintainInFlight = maintainRollingWeeklySeriesInner().finally(() => {
    maintainInFlight = null
  })
  return maintainInFlight
}

async function maintainRollingWeeklySeriesInner(): Promise<void> {
  const { error } = await supabase.rpc('maintain_my_rolling_weekly')
  if (!error) return

  if (
    error.message.includes('Could not find the function') ||
    error.message.includes('maintain_my_rolling_weekly')
  ) {
    console.warn(
      'Run supabase/27-maintain-rolling-cron.sql so rolling weekly top-up works in the background.',
    )
    return
  }

  console.warn('maintain_my_rolling_weekly failed', error.message)
}
