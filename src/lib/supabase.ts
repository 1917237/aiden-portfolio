import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/** Always defined so imports don't crash; use isSupabaseConfigured before relying on live data. */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : createClient('https://placeholder.supabase.co', 'public-anon-placeholder')

export type Profile = {
  id: string
  full_name: string
  role: 'student' | 'admin'
  credit_balance_cents: number
  class_rate_cents: number
  display_timezone: string | null
  created_at: string
}
