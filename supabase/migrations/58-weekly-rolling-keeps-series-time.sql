-- Weekly series keep rolling at their agreed day/time.
--
-- 1) Rolling no longer requires the time to be inside the weekly open hours
--    (a series moved by the admin to e.g. Tue 8 PM was skipped forever).
--    Time off (blockouts) and other lessons still skip a week.
-- 2) A series whose lessons were all marked completed keeps rolling instead
--    of being switched off as "no future lessons".
-- 3) Skipped weeks send one summary notification per run (to the student
--    and the admin) instead of one per week.
-- 4) Tops up every active weekly series right away.
--
-- Run once in Supabase → SQL Editor. No lessons, students, or credits are
-- deleted; it only books missing upcoming weekly lessons.

create or replace function public.series_start_blocked(p_start timestamptz, p_duration_minutes integer)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_date date;
  v_start_minutes integer;
  v_occupy integer;
begin
  select tutor_date, start_minutes
  into v_date, v_start_minutes
  from public.tutor_civil_from_start(p_start);

  v_occupy := public.lesson_occupied_minutes(p_duration_minutes);

  return exists (
    select 1
    from public.availability_blockouts
    where blockout_date = v_date
      and (
        start_minutes is null
        or (start_minutes >= v_start_minutes and start_minutes < v_start_minutes + v_occupy)
      )
  );
end;
$$;

create or replace function public.enforce_booking_fits_tutor_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_duration integer;
begin
  if public.is_admin() then
    return new;
  end if;

  -- Rolling weekly series book at their agreed time (system_book_series_slot).
  if current_setting('app.series_rolling', true) = 'on' then
    return new;
  end if;

  if new.slot_id is null then
    return new;
  end if;

  v_duration := coalesce(new.duration_minutes, 50);

  select s.start_time
  into v_start
  from public.availability_slots s
  where s.id = new.slot_id;

  if v_start is null then
    raise exception 'That time is not available';
  end if;

  if not public.tutor_start_fits_duration(v_start, v_duration) then
    raise exception 'That time is not available';
  end if;

  return new;
end;
$$;

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
  v_held integer;
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

  if public.series_start_blocked(p_start, v_series.duration_minutes) then
    raise exception 'Time off is scheduled then';
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
    if exists (
      select 1 from public.bookings
      where slot_id = v_slot_id and status = 'booked'
    ) then
      raise exception 'Slot is already booked';
    end if;
    update public.availability_slots
    set is_booked = false
    where id = v_slot_id;
  end if;

  -- Do not set is_booked here — on_booking_created / mark_slot_booked owns that.
  update public.availability_slots
  set end_time = v_occupy_end
  where id = v_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_slot_id
    and start_time >= p_start
    and start_time < v_occupy_end;

  v_held := public.hold_credits_for_lesson(
    v_series.student_id,
    v_series.duration_minutes,
    v_series.pay_later
  );

  perform set_config('app.series_rolling', 'on', true);

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    series_id,
    charged_cents
  )
  values (
    v_series.student_id,
    v_slot_id,
    v_series.duration_minutes,
    v_series.pay_later,
    p_series_id,
    nullif(v_held, 0)
  )
  returning id into v_booking_id;

  perform set_config('app.series_rolling', 'off', true);

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

revoke all on function public.system_book_series_slot(uuid, timestamptz, boolean) from public, anon, authenticated;

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
  v_skipped_lines text := '';
  v_student_name text;
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

  -- Completed lessons still anchor the series; only cancellations end it.
  select min(s.start_time),
         max(s.start_time),
         count(*) filter (where b.status = 'booked' and s.start_time >= now())
  into v_anchor, v_last, v_future_count
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status in ('booked', 'completed');

  if v_anchor is null then
    perform public.deactivate_series_if_no_future(p_series_id);
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'no_lessons',
      'deactivated', true
    );
  end if;

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
        and b.status in ('booked', 'completed')
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
        v_skipped := v_skipped + 1;
        v_skipped_lines := v_skipped_lines
          || E'\n• ' || public.format_lesson_when(v_start) || ' (' || sqlerrm || ')';
    end;
  end loop;

  if v_skipped > 0 then
    select full_name into v_student_name
    from public.profiles
    where id = v_series.student_id;

    perform public.notify_user(
      v_series.student_id,
      'Weekly class skipped',
      'These weekly classes could not be booked and were skipped:' || v_skipped_lines,
      'weekly_skip'
    );

    perform public.notify_admins(
      'Weekly class skipped',
      coalesce(v_student_name, 'A student') || '''s weekly classes were skipped:' || v_skipped_lines,
      'weekly_skip'
    );
  end if;

  return jsonb_build_object(
    'series_id', p_series_id,
    'booked', v_booked,
    'skipped_weeks', v_skipped,
    'future_count', v_future_count
  );
end;
$$;

revoke all on function public.maintain_one_rolling_series(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Frankie's series may have been switched off by the old rule after her last
-- lesson was completed; turn it back on.
update public.weekly_series
set active = true,
    rolling = true
where id = 'e630d9ee-0077-4374-9739-d0076a110cd8';

-- Top up every active weekly series now (books the next 4 weeks).
select public.maintain_all_rolling_weekly();
