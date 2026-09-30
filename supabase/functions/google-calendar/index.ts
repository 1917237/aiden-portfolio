import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
}

const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

type Connection = {
  refresh_token: string | null
  google_email: string | null
  calendar_id: string
  sync_secret: string
}

type EventBody = {
  summary: string
  description: string
  location?: string
  start: { dateTime: string }
  end: { dateTime: string }
  attendees: { email: string; displayName?: string }[]
  reminders: { useDefault: boolean; overrides: { method: string; minutes: number }[] }
  guestsCanModify: boolean
  status: 'confirmed'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function env(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name} secret`)
  return value
}

function redirectUri() {
  return `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/google-calendar/callback`
}

function siteUrl() {
  return (Deno.env.get('SITE_URL') ?? 'https://aidenluo.com').replace(/\/$/, '')
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env('GOOGLE_CLIENT_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64Url(new Uint8Array(signature))
}

async function makeState(userId: string) {
  const payload = `${userId}.${Date.now()}`
  return `${payload}.${await hmac(payload)}`
}

async function verifyState(state: string | null) {
  if (!state) return false
  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [userId, issuedAt, signature] = parts
  if (Date.now() - Number(issuedAt) > STATE_MAX_AGE_MS) return false
  return (await hmac(`${userId}.${issuedAt}`)) === signature
}

function serviceClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData } = await userClient.auth.getUser()
  if (!userData.user) return null
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()
  return profile?.role === 'admin' ? userData.user.id : null
}

async function loadConnection(db: SupabaseClient) {
  const { data, error } = await db
    .from('google_calendar_connection')
    .select('refresh_token, google_email, calendar_id, sync_secret')
    .eq('id', true)
    .single()
  if (error) throw new Error(error.message)
  return data as Connection
}

async function accessToken(db: SupabaseClient, connection: Connection) {
  if (!connection.refresh_token) throw new Error('Google Calendar is not connected')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const body = await response.json()
  if (!response.ok) {
    if (body?.error === 'invalid_grant') {
      await db
        .from('google_calendar_connection')
        .update({ refresh_token: null, connected_at: null, updated_at: new Date().toISOString() })
        .eq('id', true)
      throw new Error('Google access was revoked or expired. Reconnect Google Calendar.')
    }
    throw new Error(`Google token refresh failed: ${body?.error_description ?? body?.error ?? response.status}`)
  }
  return body.access_token as string
}

function eventIdFor(bookingId: string) {
  // Google event ids allow base32hex (0-9, a-v); a dashless uuid fits and keeps ids stable.
  return bookingId.replace(/-/g, '').toLowerCase()
}

async function buildEventBody(db: SupabaseClient, bookingId: string) {
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, status, student_id, slot_id, duration_minutes, meeting_url, pay_later')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!booking || booking.status === 'cancelled' || !booking.slot_id) return { kind: 'remove' as const }
  if (booking.status !== 'booked') return { kind: 'skip' as const }

  const { data: slot, error: slotError } = await db
    .from('availability_slots')
    .select('start_time')
    .eq('id', booking.slot_id)
    .single()
  if (slotError) throw new Error(slotError.message)

  const { data: profile } = await db
    .from('profiles')
    .select('full_name')
    .eq('id', booking.student_id)
    .maybeSingle()
  const { data: authUser } = await db.auth.admin.getUserById(booking.student_id)

  const duration = booking.duration_minutes ?? 50
  const start = new Date(slot.start_time)
  const end = new Date(start.getTime() + duration * 60_000)
  const name = profile?.full_name?.trim() || 'Student'
  const email = authUser?.user?.email ?? null
  const meetingUrl = booking.meeting_url?.trim() || null

  const descriptionLines = [
    `Tutoring lesson with ${name} (${duration} min).`,
    meetingUrl ? `Join: ${meetingUrl}` : null,
    booking.pay_later ? 'Payment: pay later' : null,
    `Manage lessons: ${siteUrl()}/tutoring`,
  ].filter(Boolean)

  const body: EventBody = {
    summary: `Tutoring: ${name} (${duration} min)`,
    description: descriptionLines.join('\n'),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: email ? [{ email, displayName: name }] : [],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    guestsCanModify: false,
    status: 'confirmed',
  }
  if (meetingUrl) body.location = meetingUrl
  return { kind: 'upsert' as const, body }
}

function sameInstant(a?: string, b?: string) {
  return Boolean(a && b) && new Date(a as string).getTime() === new Date(b as string).getTime()
}

function changedFields(existing: Record<string, any>, next: EventBody) {
  const patch: Record<string, unknown> = {}
  if (existing.status !== 'confirmed') Object.assign(patch, next)
  if (existing.summary !== next.summary) patch.summary = next.summary
  if ((existing.description ?? '') !== next.description) patch.description = next.description
  if ((existing.location ?? '') !== (next.location ?? '')) patch.location = next.location ?? ''
  if (!sameInstant(existing.start?.dateTime, next.start.dateTime)) patch.start = next.start
  if (!sameInstant(existing.end?.dateTime, next.end.dateTime)) patch.end = next.end
  const existingEmails = (existing.attendees ?? [])
    .map((a: { email?: string }) => a.email?.toLowerCase())
    .sort()
    .join(',')
  const nextEmails = next.attendees.map((a) => a.email.toLowerCase()).sort().join(',')
  if (existingEmails !== nextEmails) patch.attendees = next.attendees
  return patch
}

async function googleFetch(token: string, path: string, init: RequestInit = {}) {
  return await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

async function syncBooking(db: SupabaseClient, connection: Connection, token: string, bookingId: string) {
  const calendar = encodeURIComponent(connection.calendar_id || 'primary')
  const eventId = eventIdFor(bookingId)
  const eventPath = `/calendars/${calendar}/events/${eventId}`
  const plan = await buildEventBody(db, bookingId)
  if (plan.kind === 'skip') return 'skipped'

  const existingResponse = await googleFetch(token, eventPath)
  const existing = existingResponse.ok ? await existingResponse.json() : null
  if (!existingResponse.ok && existingResponse.status !== 404 && existingResponse.status !== 410) {
    throw new Error(`Google read failed (${existingResponse.status}): ${await existingResponse.text()}`)
  }

  if (plan.kind === 'remove') {
    if (!existing || existing.status === 'cancelled') return 'already removed'
    const response = await googleFetch(token, `${eventPath}?sendUpdates=all`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new Error(`Google delete failed (${response.status}): ${await response.text()}`)
    }
    return 'removed'
  }

  if (!existing) {
    const response = await googleFetch(token, `/calendars/${calendar}/events?sendUpdates=all`, {
      method: 'POST',
      body: JSON.stringify({ id: eventId, ...plan.body }),
    })
    if (response.ok) return 'created'
    if (response.status !== 409) {
      throw new Error(`Google create failed (${response.status}): ${await response.text()}`)
    }
  }

  const patch = existing ? changedFields(existing, plan.body) : plan.body
  if (Object.keys(patch).length === 0) return 'unchanged'
  const response = await googleFetch(token, `${eventPath}?sendUpdates=all`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!response.ok) {
    throw new Error(`Google update failed (${response.status}): ${await response.text()}`)
  }
  return 'updated'
}

async function syncUpcoming(db: SupabaseClient) {
  const connection = await loadConnection(db)
  const token = await accessToken(db, connection)
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: bookings, error } = await db
    .from('bookings')
    .select('id, availability_slots!inner(start_time)')
    .eq('status', 'booked')
    .gte('availability_slots.start_time', since)
  if (error) throw new Error(error.message)

  let synced = 0
  let failed = 0
  for (const booking of bookings ?? []) {
    try {
      await syncBooking(db, connection, token, booking.id)
      synced += 1
    } catch (err) {
      failed += 1
      console.error(`sync ${booking.id} failed`, err)
    }
  }
  return { synced, failed }
}

async function handleCallback(url: URL) {
  const fail = (reason: string) =>
    Response.redirect(`${siteUrl()}/tutoring/calendar?google=error&reason=${encodeURIComponent(reason)}`, 302)

  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') ?? 'denied')
  if (!(await verifyState(url.searchParams.get('state')))) return fail('Link expired, try Connect again')
  const code = url.searchParams.get('code')
  if (!code) return fail('Missing code from Google')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await response.json()
  if (!response.ok) return fail(tokens?.error_description ?? tokens?.error ?? 'Token exchange failed')
  if (!tokens.refresh_token) return fail('Google did not return offline access, try Connect again')

  let email: string | null = null
  if (typeof tokens.id_token === 'string') {
    try {
      const payload = tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      email = JSON.parse(atob(payload)).email ?? null
    } catch {
      email = null
    }
  }

  const db = serviceClient()
  const { error } = await db
    .from('google_calendar_connection')
    .update({
      refresh_token: tokens.refresh_token,
      google_email: email,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
  if (error) return fail(error.message)

  const backfill = syncUpcoming(db).catch((err) => console.error('backfill failed', err))
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions.
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(backfill)

  return Response.redirect(`${siteUrl()}/tutoring/calendar?google=connected`, 302)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)

  try {
    if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
      return await handleCallback(url)
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    let body: { action?: string; booking_id?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const db = serviceClient()

    if (body.action === 'sync') {
      const connection = await loadConnection(db)
      if (req.headers.get('x-sync-secret') !== connection.sync_secret) {
        return json({ error: 'Not authorized' }, 401)
      }
      if (!body.booking_id) return json({ error: 'booking_id is required' }, 400)
      if (!connection.refresh_token) return json({ result: 'not connected' })
      const token = await accessToken(db, connection)
      const result = await syncBooking(db, connection, token, body.booking_id)
      return json({ result })
    }

    const adminId = await requireAdmin(req)
    if (!adminId) return json({ error: 'Not authorized' }, 403)

    if (body.action === 'auth_url') {
      const params = new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'),
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: await makeState(adminId),
      })
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
    }

    if (body.action === 'sync_all') {
      return json(await syncUpcoming(db))
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    console.error(message)
    return json({ error: message }, 500)
  }
})
