export type IntegrationTestEnv = {
  supabaseUrl: string
  anonKey: string
  studentEmail: string
  studentPassword: string
  adminEmail: string
  adminPassword: string
}

function trim(value: string | undefined) {
  return value?.trim() ?? ''
}

export function loadIntegrationTestEnv(): IntegrationTestEnv | null {
  const supabaseUrl = trim(process.env.VITE_SUPABASE_URL)
  const anonKey = trim(process.env.VITE_SUPABASE_ANON_KEY)
  const studentEmail = trim(process.env.INTEGRATION_TEST_STUDENT_EMAIL)
  const studentPassword = trim(process.env.INTEGRATION_TEST_STUDENT_PASSWORD)
  const adminEmail = trim(process.env.INTEGRATION_TEST_ADMIN_EMAIL)
  const adminPassword = trim(process.env.INTEGRATION_TEST_ADMIN_PASSWORD)

  if (!supabaseUrl || !anonKey || !studentEmail || !studentPassword || !adminEmail || !adminPassword) {
    return null
  }

  return {
    supabaseUrl,
    anonKey,
    studentEmail,
    studentPassword,
    adminEmail,
    adminPassword,
  }
}

export const integrationSkipReason =
  'Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and INTEGRATION_TEST_* credentials in .env'
