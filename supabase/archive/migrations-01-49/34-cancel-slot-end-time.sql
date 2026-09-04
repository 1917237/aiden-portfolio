-- Use real lesson occupy window when freeing slots (not hardcoded 60 min). Run after 33.

-- ---------------------------------------------------------------------------
-- Admin / shared cancel core
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking_core(
  p_booking_id uuid,
  p_comment text default null,
  p_notify boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_series_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
  v_body text;
begin
  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
  from public.bookings b
  left join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    return;
  end if;

  if v_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  perform public.release_booking_credits(p_booking_id);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  if v_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_occupy_end
    where id = v_slot_id;

    perform public.restore_open_starts_in_range(v_start, v_occupy_end);
  end if;

  perform public.deactivate_series_if_no_future(v_series_id);

  if p_notify then
    v_body := 'Your class on '
      || public.format_lesson_when(v_start)
      || ' was cancelled by your tutor.';

    if p_comment is not null and length(trim(p_comment)) > 0 then
      v_body := v_body || E'\n\nNote from your tutor: ' || trim(p_comment);
    end if;

    perform public.notify_user(
      v_student_id,
      'Class cancelled',
      v_body,
      'class_cancelled'
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Student cancel
-- ---------------------------------------------------------------------------
create or replace function public.student_cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_series_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
  v_student_name text;
  v_stopped boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
  from public.bookings b
  left join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  if v_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

  if v_start < now() then
    raise exception 'Past classes cannot be cancelled';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  perform public.release_booking_credits(p_booking_id);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  if v_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_occupy_end
    where id = v_slot_id;

    perform public.restore_open_starts_in_range(v_start, v_occupy_end);
  end if;

  v_stopped := public.deactivate_series_if_no_future(v_series_id);

  perform public.notify_admins(
    'Class cancelled by student',
    coalesce(v_student_name, 'A student')
      || ' cancelled their class on '
      || public.format_lesson_when(v_start)
      || case when v_stopped then ' (weekly series stopped — no upcoming lessons left).' else '.' end,
    'student_cancelled'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Student reschedule (free old slot with correct occupy end)
-- ---------------------------------------------------------------------------
create or replace function public.student_reschedule_my_booking(
  p_booking_id uuid,
  p_new_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_old_start timestamptz;
  v_duration integer;
  v_occupy_mins integer;
  v_old_occupy_end timestamptz;
  v_new_occupy_end timestamptz;
  v_new_slot_id uuid;
  v_new_is_booked boolean;
  v_student_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_old_slot_id, v_status, v_student_id, v_old_start, v_duration
  from public.bookings b
  left join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if v_old_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

  if v_old_start < now() then
    raise exception 'Past classes cannot be rescheduled';
  end if;

  if p_new_start < now() then
    raise exception 'That time has already passed';
  end if;

  if p_new_start = v_old_start then
    return;
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_occupy_mins := public.lesson_occupied_minutes(v_duration);
  v_old_occupy_end := v_old_start + make_interval(mins => v_occupy_mins);
  v_new_occupy_end := p_new_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_new_start, v_new_occupy_end, p_booking_id) then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

  select id, is_booked
  into v_new_slot_id, v_new_is_booked
  from public.availability_slots
  where start_time = p_new_start
  for update;

  if v_new_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_new_start, v_new_occupy_end, false)
    returning id into v_new_slot_id;
    v_new_is_booked := false;
  elsif v_new_is_booked then
    raise exception 'Sorry, another student just booked this slot.';
  elsif v_new_slot_id = v_old_slot_id then
    update public.availability_slots
    set start_time = p_new_start,
        end_time = v_new_occupy_end,
        is_booked = true
    where id = v_old_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_old_slot_id
      and start_time >= p_new_start
      and start_time < v_new_occupy_end;

    perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

    perform public.notify_admins(
      'Class rescheduled by student',
      coalesce(v_student_name, 'A student')
        || ' moved their class from '
        || public.format_lesson_when(v_old_start)
        || ' to '
        || public.format_lesson_when(p_new_start)
        || '.',
      'student_rescheduled'
    );
    return;
  end if;

  update public.availability_slots
  set end_time = v_new_occupy_end,
      is_booked = true
  where id = v_new_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_new_slot_id
    and start_time >= p_new_start
    and start_time < v_new_occupy_end;

  update public.bookings
  set slot_id = v_new_slot_id
  where id = p_booking_id;

  if v_old_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_old_occupy_end
    where id = v_old_slot_id;
  end if;

  perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

  perform public.notify_admins(
    'Class rescheduled by student',
    coalesce(v_student_name, 'A student')
      || ' moved their class from '
      || public.format_lesson_when(v_old_start)
      || ' to '
      || public.format_lesson_when(p_new_start)
      || '.',
    'student_rescheduled'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Stop weekly series (cancel loop)
-- ---------------------------------------------------------------------------
create or replace function public.stop_my_weekly_series(
  p_series_id uuid,
  p_mode text,
  p_stop_on_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_student_name text;
  v_cutoff timestamptz;
  v_mode text;
  v_booking record;
  v_occupy_end timestamptz;
  v_cancelled integer := 0;
  v_kept integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_mode := lower(trim(coalesce(p_mode, '')));
  if v_mode not in ('now', 'on_date') then
    raise exception 'Invalid stop mode';
  end if;

  if v_mode = 'on_date' and p_stop_on_date is null then
    raise exception 'Pick a stop date';
  end if;

  if v_mode = 'on_date' and p_stop_on_date < (timezone(public.tutor_schedule_timezone(), now()))::date then
    raise exception 'Stop date must be today or later';
  end if;

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if v_series.student_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not your weekly series';
  end if;

  if not v_series.active then
    raise exception 'This weekly series is already stopped';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_series.student_id;

  if v_mode = 'now' then
    v_cutoff := now();
  else
    v_cutoff := ((p_stop_on_date + 1)::timestamp AT TIME ZONE public.tutor_schedule_timezone());
  end if;

  perform public.lock_booking_calendar();

  for v_booking in
    select
      b.id as booking_id,
      b.slot_id,
      b.duration_minutes,
      s.start_time
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.series_id = p_series_id
      and b.status = 'booked'
      and s.start_time >= v_cutoff
    order by s.start_time
    for update of b
  loop
    v_occupy_end := v_booking.start_time + make_interval(
      mins => public.lesson_occupied_minutes(coalesce(v_booking.duration_minutes, 50))
    );

    perform public.release_booking_credits(v_booking.booking_id);

    update public.bookings
    set status = 'cancelled'
    where id = v_booking.booking_id;

    if v_booking.slot_id is not null then
      update public.availability_slots
      set is_booked = false,
          end_time = v_occupy_end
      where id = v_booking.slot_id;
    end if;

    perform public.restore_open_starts_in_range(v_booking.start_time, v_occupy_end);
    v_cancelled := v_cancelled + 1;
  end loop;

  select count(*)::integer into v_kept
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked'
    and s.start_time >= now();

  update public.weekly_series
  set active = false,
      rolling = false
  where id = p_series_id;

  if v_mode = 'now' then
    perform public.notify_admins(
      'Weekly series stopped',
      coalesce(v_student_name, 'A student')
        || ' stopped their weekly series now. Cancelled '
        || v_cancelled::text
        || ' upcoming class'
        || case when v_cancelled = 1 then '' else 'es' end
        || '.',
      'weekly_stopped'
    );
  else
    perform public.notify_admins(
      'Weekly series ending',
      coalesce(v_student_name, 'A student')
        || ' will end their weekly series after '
        || to_char(p_stop_on_date, 'Mon FMDD, YYYY')
        || '. Cancelled '
        || v_cancelled::text
        || ' class'
        || case when v_cancelled = 1 then '' else 'es' end
        || ' after that date'
        || case when v_kept > 0 then ' (' || v_kept::text || ' still scheduled through the stop date)' else '' end
        || '.',
      'weekly_stopped'
    );
  end if;

  return jsonb_build_object(
    'series_id', p_series_id,
    'mode', v_mode,
    'stop_on_date', p_stop_on_date,
    'cancelled_count', v_cancelled,
    'kept_count', v_kept
  );
end;
$$;

notify pgrst, 'reload schema';
