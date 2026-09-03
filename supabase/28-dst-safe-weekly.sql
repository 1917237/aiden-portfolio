-- DST-safe weekly offsets: keep tutor wall-clock time (America/Los_Angeles)
-- Run after 27.

create or replace function public.add_weeks_tutor_wall(
  p_start timestamptz,
  p_weeks integer
)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp;
  v_date date;
  v_time time;
begin
  if coalesce(p_weeks, 0) = 0 then
    return p_start;
  end if;

  v_local := p_start at time zone 'America/Los_Angeles';
  v_date := (v_local::date) + (p_weeks * 7);
  v_time := v_local::time;
  -- Interpret civil date+time in tutor TZ → timestamptz
  return (v_date + v_time) at time zone 'America/Los_Angeles';
end;
$$;

grant execute on function public.add_weeks_tutor_wall(timestamptz, integer) to authenticated;

-- Patch weekly booking loop in student_book_lesson
create or replace function public.student_book_lesson(
  p_slot_id uuid,
  p_duration_minutes integer default 50,
  p_weekly boolean default false,
  p_pay_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_ids uuid[] := '{}';
  v_series_id uuid;
  v_base_start timestamptz;
  v_target_start timestamptz;
  v_slot_id uuid;
  v_is_booked boolean;
  v_booking_id uuid;
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  i integer;
  v_student_name text;
  v_times text := '';
  v_booked_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can book lessons';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  perform public.lock_booking_calendar();

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);

  select start_time into v_base_start
  from public.availability_slots
  where id = p_slot_id;

  if v_base_start is null then
    raise exception 'Slot not found';
  end if;

  if p_weekly then
    v_series_id := gen_random_uuid();
    insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
    values (v_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true);
  end if;

  for i in 0..case when p_weekly then 3 else 0 end loop
    v_target_start := public.add_weeks_tutor_wall(v_base_start, i);
    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    select id, is_booked
    into v_slot_id, v_is_booked
    from public.availability_slots
    where start_time = v_target_start
    for update;

    if p_weekly then
      if v_slot_id is null or v_is_booked or v_target_start < now() then
        continue;
      end if;

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
        continue;
      end if;
    else
      if v_slot_id is null then
        raise exception 'That time is not available';
      end if;

      if v_is_booked then
        raise exception 'Slot is already booked';
      end if;

      if v_target_start < now() then
        raise exception 'That time has already passed';
      end if;

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
        raise exception 'Another lesson is already scheduled during that time';
      end if;
    end if;

    update public.availability_slots
    set end_time = v_occupy_end
    where id = v_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_slot_id
      and start_time >= v_target_start
      and start_time < v_occupy_end;

    insert into public.bookings (
      student_id,
      slot_id,
      duration_minutes,
      pay_later,
      series_id
    )
    values (auth.uid(), v_slot_id, p_duration_minutes, p_pay_later, v_series_id)
    returning id into v_booking_id;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);
    v_booked_count := v_booked_count + 1;
    if v_times = '' then
      v_times := public.format_lesson_when(v_target_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_target_start);
    end if;
  end loop;

  if cardinality(v_booking_ids) = 0 then
    raise exception 'None of the weekly times are available';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  if p_weekly then
    perform public.notify_admins(
      'New weekly series booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly series ('
        || v_booked_count::text
        || ' lessons, '
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || '): '
        || v_times
        || '.',
      'booking_weekly'
    );
  else
    perform public.notify_admins(
      'New class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a single class for '
        || v_times
        || ' ('
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || ').',
      'booking_single'
    );
  end if;

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

-- Patch rolling maintainer to use wall-clock weeks
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

  -- Smallest week index at/after now (wall-clock in tutor TZ)
  v_k := 0;
  while public.add_weeks_tutor_wall(v_anchor, v_k) < now() loop
    v_k := v_k + 1;
    if v_k > 520 then
      exit;
    end if;
  end loop;

  -- First week strictly after the latest booked occurrence
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

revoke all on function public.maintain_one_rolling_series(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
