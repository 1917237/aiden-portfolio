-- Move a weekly series (this lesson and every later one) to a new day/time,
-- and keep future auto-booked weeks on the new time.
-- Also gives the server role (Edge Functions) table access it was missing.
--
-- Run 55-admin-reschedule-clear-open-slots.sql first, then this, in
-- Supabase → SQL Editor. No existing lessons, students, or credits are changed.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter table public.weekly_series
  add column if not exists anchor_start timestamptz;

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

  if v_anchor is null or v_future_count = 0 then
    perform public.deactivate_series_if_no_future(p_series_id);
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'no_future_lessons',
      'deactivated', true
    );
  end if;

  -- A moved series keeps rolling on its new day/time.
  v_anchor := coalesce(v_series.anchor_start, v_anchor);

  if v_future_count >= v_target_count then
    return jsonb_build_object(
      'series_id', p_series_id,
      'booked', 0,
      'skipped_weeks', 0,
      'future_count', v_future_count
    );
  end if;

  v_k := 0;
  while public.add_weeks_tutor_wall(v_anchor, v_k) < now() loop
    v_k := v_k + 1;
    if v_k > 520 then
      exit;
    end if;
  end loop;

  v_k_after_last := 0;
  while public.add_weeks_tutor_wall(v_anchor, v_k_after_last) <= v_last loop
    v_k_after_last := v_k_after_last + 1;
    if v_k_after_last > 520 then
      exit;
    end if;
  end loop;

  v_k := greatest(v_k, v_k_after_last);

  while v_future_count < v_target_count and v_attempts < v_max_lookahead loop
    v_start := public.add_weeks_tutor_wall(v_anchor, v_k);
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

create or replace function public.admin_reschedule_series_from(
  p_booking_id uuid,
  p_start_time timestamptz,
  p_duration_minutes integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_student_id uuid;
  v_old_start timestamptz;
  v_duration integer;
  v_row record;
  v_weeks integer;
  v_new_start timestamptz;
  v_local timestamp;
  v_occupy integer;
  v_moved integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select b.series_id, b.student_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_series_id, v_student_id, v_old_start, v_duration
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
    and b.status = 'booked';

  if v_old_start is null then
    raise exception 'Booking not found';
  end if;

  if v_series_id is null then
    raise exception 'This lesson is not part of a weekly series';
  end if;

  if p_duration_minutes is not null then
    if p_duration_minutes not in (25, 50, 80, 110) then
      raise exception 'Invalid lesson duration';
    end if;
    v_duration := p_duration_minutes;
  end if;

  v_occupy := public.lesson_occupied_minutes(v_duration);

  for v_row in
    select b.id, s.start_time
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.series_id = v_series_id
      and b.status = 'booked'
      and s.start_time >= v_old_start
    order by s.start_time
  loop
    v_weeks := round(extract(epoch from (v_row.start_time - v_old_start)) / 604800.0)::integer;
    v_new_start := public.add_weeks_tutor_wall(p_start_time, v_weeks);
    v_local := v_new_start at time zone 'America/Los_Angeles';

    begin
      perform public.admin_reschedule_booking_to_time(
        v_row.id,
        v_local::date,
        (extract(hour from v_local) * 60 + extract(minute from v_local))::integer,
        v_new_start,
        v_new_start + make_interval(mins => v_occupy),
        v_duration
      );
    exception
      when others then
        raise exception '% is not free: %', public.format_lesson_when(v_new_start), sqlerrm;
    end;

    v_moved := v_moved + 1;
  end loop;

  update public.weekly_series
  set anchor_start = p_start_time,
      duration_minutes = v_duration
  where id = v_series_id;

  perform public.notify_user(
    v_student_id,
    'Weekly class time changed',
    'Your weekly class now starts '
      || public.format_lesson_when(p_start_time)
      || ' and repeats every week at that time.',
    'series_rescheduled'
  );

  return v_moved;
end;
$$;

grant execute on function public.admin_reschedule_series_from(uuid, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
