-- Private ICS calendar feeds (Google / Apple subscribe). Run after 34.

create table if not exists public.calendar_feed_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calendar_feed_tokens enable row level security;

drop policy if exists "Users read own calendar feed token" on public.calendar_feed_tokens;
create policy "Users read own calendar feed token"
  on public.calendar_feed_tokens for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.ensure_my_calendar_feed_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.calendar_feed_tokens (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select token into v_token
  from public.calendar_feed_tokens
  where user_id = auth.uid();

  return v_token;
end;
$$;

grant execute on function public.ensure_my_calendar_feed_token() to authenticated;

create or replace function public.rotate_my_calendar_feed_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.calendar_feed_tokens
  set token = gen_random_uuid(),
      updated_at = now()
  where user_id = auth.uid()
  returning token into v_token;

  if v_token is null then
    return public.ensure_my_calendar_feed_token();
  end if;

  return v_token;
end;
$$;

grant execute on function public.rotate_my_calendar_feed_token() to authenticated;

-- Edge function only (service role). Token in URL is the secret.
create or replace function public.get_calendar_feed_events(p_token uuid)
returns table (
  booking_id uuid,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_is_admin boolean;
begin
  select t.user_id, p.role = 'admin'
  into v_user_id, v_is_admin
  from public.calendar_feed_tokens t
  join public.profiles p on p.id = t.user_id
  where t.token = p_token;

  if v_user_id is null then
    return;
  end if;

  return query
  select
    b.id as booking_id,
    case
      when v_is_admin then coalesce(sp.full_name, 'Student') || ' — ' || coalesce(b.duration_minutes, 50)::text || ' min'
      else 'Tutoring lesson'
    end as title,
    case
      when b.pay_later then 'Pay later'
      else 'Credits on file'
    end as description,
    s.start_time as start_at,
    s.start_time + make_interval(mins => coalesce(b.duration_minutes, 50)) as end_at,
    b.status
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  left join public.profiles sp on sp.id = b.student_id
  where b.status = 'booked'
    and s.start_time >= now() - interval '6 hours'
    and (
      (v_is_admin and b.student_id is not null)
      or (not v_is_admin and b.student_id = v_user_id)
    )
  order by s.start_time asc;
end;
$$;

revoke all on function public.get_calendar_feed_events(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
