-- Student cancel / reschedule own lessons + admin notify (run after 24–25)

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
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
  v_student_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_start, v_duration
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
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

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false,
      end_time = v_start + interval '60 minutes'
  where id = v_slot_id;

  perform public.restore_open_starts_in_range(v_start, v_occupy_end);

  perform public.notify_admins(
    'Class cancelled by student',
    coalesce(v_student_name, 'A student')
      || ' cancelled their class on '
      || public.format_lesson_when(v_start)
      || '.',
    'student_cancelled'
  );
end;
$$;

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
  join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if v_old_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
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

  -- Prefer an existing open slot at the new start; otherwise create one.
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
    -- Same row shouldn't happen when starts differ, but keep safe.
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

  update public.availability_slots
  set is_booked = false,
      end_time = v_old_start + interval '60 minutes'
  where id = v_old_slot_id;

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

grant execute on function public.student_cancel_my_booking(uuid) to authenticated;
grant execute on function public.student_reschedule_my_booking(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
