-- Rolling weekly top-up in the database + optional pg_cron (run after 26)
-- Keeps active rolling series filled even when students do not open the app.

create or replace function public.tutor_civil_from_start(p_start timestamptz)
returns table(tutor_date date, start_minutes integer, dow integer)
language sql
stable
as $$
  select
    (p_start at time zone 'America/Los_Angeles')::date as tutor_date,
    (
      extract(hour from (p_start at time zone 'America/Los_Angeles'))::integer * 60
      + extract(minute from (p_start at time zone 'America/Los_Angeles'))::integer
    ) as start_minutes,
    extract(dow from (p_start at time zone 'America/Los_Angeles')::date)::integer as dow;
$$;

-- One 15-min tutor civil start is open (weekly − blockouts + extras).
create or replace function public.tutor_minute_is_open(
  p_date date,
  p_start_minutes integer,
  p_dow integer
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_whole_day boolean;
  v_is_extra boolean;
  v_is_weekly boolean;
  v_is_blocked boolean;
begin
  select exists (
    select 1
    from public.availability_blockouts b
    where b.blockout_date = p_date
      and b.start_minutes is null
  ) into v_whole_day;

  select exists (
    select 1
    from public.date_availability d
    where d.availability_date = p_date
      and d.start_minutes = p_start_minutes
  ) into v_is_extra;

  if v_whole_day then
    return v_is_extra;
  end if;

  select exists (
    select 1
    from public.weekly_availability w
    where w.day_of_week = p_dow
      and w.start_minutes = p_start_minutes
  ) into v_is_weekly;

  select exists (
    select 1
    from public.availability_blockouts b
    where b.blockout_date = p_date
      and b.start_minutes = p_start_minutes
  ) into v_is_blocked;

  if v_is_extra then
    return true;
  end if;

  return v_is_weekly and not v_is_blocked;
end;
$$;

create or replace function public.tutor_start_fits_duration(
  p_start timestamptz,
  p_duration_minutes integer
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_date date;
  v_start_minutes integer;
  v_dow integer;
  v_occupy integer;
  v_m integer;
begin
  select tutor_date, start_minutes, dow
  into v_date, v_start_minutes, v_dow
  from public.tutor_civil_from_start(p_start);

  if v_start_minutes % 15 <> 0 then
    return false;
  end if;

  v_occupy := public.lesson_occupied_minutes(p_duration_minutes);
  v_m := 0;
  while v_m < v_occupy loop
    if not public.tutor_minute_is_open(v_date, v_start_minutes + v_m, v_dow) then
      return false;
    end if;
    v_m := v_m + 15;
  end loop;

  return true;
end;
$$;

-- Book a series lesson without requiring the student to be signed in (cron / system).
create or replace function public.system_book_series_slot(
  p_series_id uuid,
  p_start timestamptz,
  p_notify boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_slot_id uuid;
  v_is_booked boolean;
  v_occupy_mins integer;
  v_occupy_end timestamptz;
  v_booking_id uuid;
  v_student_name text;
begin
  perform public.lock_booking_calendar();

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if not v_series.active or not v_series.rolling then
    raise exception 'This weekly series is no longer active';
  end if;

  if p_start < now() then
    raise exception 'That time has already passed';
  end if;

  if not public.tutor_start_fits_duration(p_start, v_series.duration_minutes) then
    raise exception 'That time is not available';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(v_series.duration_minutes);
  v_occupy_end := p_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_start, v_occupy_end) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  select id, is_booked
  into v_slot_id, v_is_booked
  from public.availability_slots
  where start_time = p_start
  for update;

  if v_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_start, v_occupy_end, false)
    returning id into v_slot_id;
    v_is_booked := false;
  elsif v_is_booked then
    raise exception 'Slot is already booked';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end,
      is_booked = true
  where id = v_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_slot_id
    and start_time >= p_start
    and start_time < v_occupy_end;

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    series_id
  )
  values (
    v_series.student_id,
    v_slot_id,
    v_series.duration_minutes,
    v_series.pay_later,
    p_series_id
  )
  returning id into v_booking_id;

  if p_notify then
    select full_name into v_student_name
    from public.profiles
    where id = v_series.student_id;

    perform public.notify_admins(
      'New weekly class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly class for '
        || public.format_lesson_when(p_start)
        || ' ('
        || v_series.duration_minutes::text
        || ' min'
        || case when v_series.pay_later then ', pay later' else '' end
        || ').',
      'booking_weekly'
    );
  end if;

  return v_booking_id;
end;
$$;

create or replace function public.maintain_one_rolling_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_anchor timestamptz;
  v_last timestamptz;
  v_future_count integer := 0;
  v_week_ms bigint := 7 * 24 * 60 * 60 * 1000;
  v_k integer;
  v_k_after_last integer;
  v_attempts integer := 0;
  v_max_lookahead integer := 12;
  v_target_count integer := 4;
  v_start timestamptz;
  v_booked integer := 0;
  v_skipped integer := 0;
  v_reason text;
  v_when text;
begin
  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found or not v_series.active or not v_series.rolling then
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'inactive'
    );
  end if;

  select min(s.start_time), max(s.start_time),
         count(*) filter (where s.start_time >= now())
  into v_anchor, v_last, v_future_count
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked';

  if v_anchor is null then
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'no_anchor'
    );
  end if;

  if v_future_count >= v_target_count then
    return jsonb_build_object(
      'series_id', p_series_id,
      'booked', 0,
      'skipped_weeks', 0,
      'future_count', v_future_count
    );
  end if;

  v_k := ceil(
    (extract(epoch from (now() - v_anchor)) * 1000) / v_week_ms
  )::integer;
  if v_anchor + make_interval(weeks => v_k) < now() then
    v_k := v_k + 1;
  end if;

  v_k_after_last := floor(
    (extract(epoch from (v_last - v_anchor)) * 1000) / v_week_ms
  )::integer + 1;
  v_k := greatest(v_k, v_k_after_last);

  while v_future_count < v_target_count and v_attempts < v_max_lookahead loop
    v_start := v_anchor + make_interval(weeks => v_k);
    v_k := v_k + 1;
    v_attempts := v_attempts + 1;

    if v_start < now() then
      continue;
    end if;

    if exists (
      select 1
      from public.bookings b
      join public.availability_slots s on s.id = b.slot_id
      where b.series_id = p_series_id
        and b.status = 'booked'
        and s.start_time = v_start
    ) then
      continue;
    end if;

    begin
      perform public.system_book_series_slot(p_series_id, v_start, false);
      v_booked := v_booked + 1;
      v_future_count := v_future_count + 1;
    exception
      when others then
        v_reason := sqlerrm;
        v_skipped := v_skipped + 1;
        v_when := public.format_lesson_when(v_start);
        perform public.notify_user(
          v_series.student_id,
          'Weekly class skipped',
          v_when
            || ' was unavailable ('
            || v_reason
            || '), so it was skipped. Your rolling weekly schedule will try the following week.',
          'weekly_skip'
        );
    end;
  end loop;

  return jsonb_build_object(
    'series_id', p_series_id,
    'booked', v_booked,
    'skipped_weeks', v_skipped,
    'future_count', v_future_count
  );
end;
$$;

create or replace function public.maintain_all_rolling_weekly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_count integer := 0;
begin
  for v_series_id in
    select id
    from public.weekly_series
    where active = true
      and rolling = true
  loop
    v_one := public.maintain_one_rolling_series(v_series_id);
    v_results := v_results || jsonb_build_array(v_one);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'series_count', v_count,
    'ran_at', now(),
    'results', v_results
  );
end;
$$;

-- Student app open: top up only their series (same logic as cron).
create or replace function public.maintain_my_rolling_weekly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  for v_series_id in
    select id
    from public.weekly_series
    where active = true
      and rolling = true
      and student_id = auth.uid()
  loop
    v_one := public.maintain_one_rolling_series(v_series_id);
    v_results := v_results || jsonb_build_array(v_one);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'series_count', v_count,
    'ran_at', now(),
    'results', v_results
  );
end;
$$;

grant execute on function public.maintain_my_rolling_weekly() to authenticated;
-- Cron / SQL Editor use maintain_all_rolling_weekly as postgres / service role.
revoke all on function public.maintain_all_rolling_weekly() from public, anon, authenticated;
grant execute on function public.maintain_all_rolling_weekly() to postgres;
-- system helpers stay locked down (called only via security definer chain)
revoke all on function public.system_book_series_slot(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.maintain_one_rolling_series(uuid) from public, anon, authenticated;

-- Schedule every 6 hours (requires Cron / pg_cron enabled in Supabase Dashboard → Integrations → Cron)
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
exception
  when others then
    raise notice 'Could not enable pg_cron (%). Enable Cron in the Supabase Dashboard, then re-run the schedule block at the bottom of 27.',
      sqlerrm;
end;
$$;

do $$
begin
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'maintain-rolling-weekly';
exception
  when undefined_table then
    raise notice 'cron.job not available yet — enable Cron in Dashboard.';
  when others then
    null;
end;
$$;

do $$
begin
  perform cron.schedule(
    'maintain-rolling-weekly',
    '15 */6 * * *',
    $cron$select public.maintain_all_rolling_weekly();$cron$
  );
  raise notice 'Scheduled maintain-rolling-weekly every 6 hours.';
exception
  when others then
    raise notice 'Could not schedule cron job (%). In Dashboard → Integrations → Cron, create a job that runs: select public.maintain_all_rolling_weekly(); every 6 hours.',
      sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
