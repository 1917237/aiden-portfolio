import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IntegrationTestEnv } from './testEnv'

export async function signInAs(
  env: IntegrationTestEnv,
  email: string,
  password: string,
): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Could not sign in as ${email}: ${error.message}`)
  }
  if (!data.user) throw new Error(`Sign in failed for ${email}`)

  return { client, userId: data.user.id }
}

/** Far-future start time, unique per test run, aligned to 15 minutes. */
export function uniqueFutureSlotWindow() {
  const baseMs = Date.now() + 60 * 24 * 60 * 60 * 1000
  const stepMs = 15 * 60 * 1000
  const startMs = Math.ceil(baseMs / stepMs) * stepMs + Math.floor(Math.random() * 4) * stepMs
  const start = new Date(startMs)
  const end = new Date(startMs + 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}
