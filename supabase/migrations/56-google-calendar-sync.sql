-- Instant Google Calendar sync.
-- Every booking change (book, reschedule, length change, cancel) pings the
-- google-calendar Edge Function, which updates the event in Aiden's Google
-- Calendar and emails the student (added as a guest).
--
-- Run once in Supabase → SQL Editor, then deploy the google-calendar function
-- (see supabase/README.md).

create extension if not exists pg_net with schema extensions;

create table if not exists public.google_calendar_connection (
  id boolean primary key default true check (id),
  refresh_token text,
  google_email text,
  calendar_id text not null default 'primary',
  sync_secret uuid not null default gen_random_uuid(),
  function_url text not null default 'https://dntujelwmbypgtxnhyin.supabase.co/functions/v1/google-calendar',
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connection enable row level security;
revoke all on table public.google_calendar_connection from anon, authenticated;

insert into public.google_calendar_connection (id) values (true)
on conflict (id) do nothing;

create or replace function public.get_google_calendar_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.google_calendar_connection;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into v_row from public.google_calendar_connection where id;

  return jsonb_build_object(
    'connected', v_row.refresh_token is not null,
    'email', v_row.google_email,
    'connected_at', v_row.connected_at
  );
end;
$$;

grant execute on function public.get_google_calendar_status() to authenticated;

create or replace function public.disconnect_google_calendar()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.google_calendar_connection
  set refresh_token = null,
      google_email = null,
      connected_at = null,
      updated_at = now()
  where id;
end;
$$;

grant execute on function public.disconnect_google_calendar() to authenticated;

create or replace function public.queue_google_calendar_sync(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn public.google_calendar_connection;
  v_queued text := coalesce(current_setting('app.gcal_queued', true), '');
begin
  if p_booking_id is null or position(p_booking_id::text in v_queued) > 0 then
    return;
  end if;

  select * into v_conn from public.google_calendar_connection where id;
  if v_conn.refresh_token is null then
    return;
  end if;

  -- One ping per booking per transaction; the function reads the committed final state.
  perform set_config('app.gcal_queued', v_queued || ',' || p_booking_id::text, true);

  perform net.http_post(
    url := v_conn.function_url,
    body := jsonb_build_object('action', 'sync', 'booking_id', p_booking_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_conn.sync_secret::text
    )
  );
exception when others then
  -- Calendar sync must never block a booking.
  raise warning 'Google Calendar sync not queued: %', sqlerrm;
end;
$$;

revoke all on function public.queue_google_calendar_sync(uuid) from public, anon, authenticated;

create or replace function public.bookings_google_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.queue_google_calendar_sync(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.slot_id is not distinct from old.slot_id
    and new.duration_minutes is not distinct from old.duration_minutes
    and new.meeting_url is not distinct from old.meeting_url
  then
    return new;
  end if;

  perform public.queue_google_calendar_sync(new.id);
  return new;
end;
$$;

drop trigger if exists bookings_google_calendar_sync on public.bookings;
create trigger bookings_google_calendar_sync
after insert or update or delete on public.bookings
for each row execute function public.bookings_google_calendar_sync();

create or replace function public.slots_google_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.start_time is distinct from old.start_time then
    perform public.queue_google_calendar_sync(b.id)
    from public.bookings b
    where b.slot_id = new.id
      and b.status = 'booked';
  end if;
  return new;
end;
$$;

drop trigger if exists availability_slots_google_calendar_sync on public.availability_slots;
create trigger availability_slots_google_calendar_sync
after update of start_time on public.availability_slots
for each row execute function public.slots_google_calendar_sync();

notify pgrst, 'reload schema';
