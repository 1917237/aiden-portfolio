import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: 'Server not configured' }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Not signed in' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: 'Not signed in' }, 401)
    }

    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()

    if (profileError || profile?.role !== 'admin') {
      return json({ error: 'Not authorized' }, 403)
    }

    let body: { email?: string; fullName?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const email = body.email?.trim().toLowerCase()
    const fullName = body.fullName?.trim()
    if (!email || !fullName) {
      return json({ error: 'Email and name are required' }, 400)
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://aidenluo.com'
    const redirectTo = `${siteUrl.replace(/\/$/, '')}/tutoring/reset-password`

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    })

    if (!error) {
      return json({ userId: data.user?.id ?? null, email, resent: false })
    }

    const already =
      /already|registered|exists/i.test(error.message) ||
      error.status === 422 ||
      error.code === 'email_exists'

    if (!already) {
      return json({ error: error.message }, 400)
    }

    // Student was invited before — resend a password setup (recovery) email.
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
      redirectTo,
    })
    if (resetError) {
      return json(
        {
          error: `Account already exists, and resending setup email failed: ${resetError.message}`,
        },
        400,
      )
    }

    // Best-effort name update on profile if the auth user id is known
    const { data: listed } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const existing = listed?.users?.find((u) => u.email?.toLowerCase() === email)
    if (existing?.id) {
      await adminClient.auth.admin.updateUserById(existing.id, {
        user_metadata: { full_name: fullName },
      })
      await adminClient.from('profiles').update({ full_name: fullName }).eq('id', existing.id)
    }

    return json({ userId: existing?.id ?? null, email, resent: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return json({ error: message }, 500)
  }
})
