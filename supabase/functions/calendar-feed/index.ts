import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type FeedRow = {
  booking_id: string
  title: string
  description: string | null
  start_at: string
  end_at: string
  status: string
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function toIcsUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function buildIcs(events: FeedRow[]) {
  const stamp = toIcsUtc(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tutoring App//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Tutoring',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:booking-${event.booking_id}@tutoring`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(event.start_at)}`,
      `DTEND:${toIcsUtc(event.end_at)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    )
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    }
    lines.push(
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Tutoring lesson in 30 minutes',
      'END:VALARM',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')?.trim()
  if (!token) {
    return new Response('Missing token', { status: 400, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response('Server not configured', { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase.rpc('get_calendar_feed_events', {
    p_token: token,
  })

  if (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders })
  }

  const ics = buildIcs((data ?? []) as FeedRow[])

  return new Response(ics, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  })
})
