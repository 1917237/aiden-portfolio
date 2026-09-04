-- Student reschedule: optional new duration + credit adjustment. Run after 35.

create or replace function public.student_reschedule_my_booking(
  p_booking_id uuid,
  p_new_start timestamptz,
  p_duration_minutes integer default null
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
  v_old_duration integer;
  v_duration integer;
  v_pay_later boolean;
  v_old_charge integer;
  v_rate integer;
  v_new_charge integer;
  v_occupy_mins integer;
  v_old_occupy_mins integer;
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

  select
    b.slot_id,
    b.status,
    b.student_id,
    s.start_time,
    coalesce(b.duration_minutes, 50),
    b.pay_later,
    b.charged_cents
  into
    v_old_slot_id,
    v_status,
    v_student_id,
    v_old_start,
    v_old_duration,
    v_pay_later,
    v_old_charge
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

  v_duration := v_old_duration;
  if p_duration_minutes is not null then
    if p_duration_minutes not in (25, 50, 80, 110) then
      raise exception 'Invalid lesson duration';
    end if;
    v_duration := p_duration_minutes;
  end if;

  if p_new_start = v_old_start and v_duration = v_old_duration then
    return;
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_old_occupy_mins := public.lesson_occupied_minutes(v_old_duration);
  v_occupy_mins := public.lesson_occupied_minutes(v_duration);
  v_old_occupy_end := v_old_start + make_interval(mins => v_old_occupy_mins);
  v_new_occupy_end := p_new_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_new_start, v_new_occupy_end, p_booking_id) then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

  -- Same start, new duration only
  if p_new_start = v_old_start then
    if v_old_slot_id is not null then
      update public.availability_slots
      set end_time = v_new_occupy_end,
          is_booked = true
      where id = v_old_slot_id;

      delete from public.availability_slots
      where is_booked = false
        and id <> v_old_slot_id
        and start_time >= p_new_start
        and start_time < v_new_occupy_end;

      if v_new_occupy_end < v_old_occupy_end then
        perform public.restore_open_starts_in_range(v_new_occupy_end, v_old_occupy_end);
      end if;
    end if;

    if not v_pay_later then
      select class_rate_cents into v_rate
      from public.profiles
      where id = v_student_id
      for update;

      v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
      if coalesce(v_old_charge, 0) <> v_new_charge then
        update public.profiles
        set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
        where id = v_student_id;
      end if;

      update public.bookings
      set duration_minutes = v_duration,
          charged_cents = v_new_charge
      where id = p_booking_id;
    else
      update public.bookings
      set duration_minutes = v_duration
      where id = p_booking_id;
    end if;

    perform public.notify_admins(
      'Class rescheduled by student',
      coalesce(v_student_name, 'A student')
        || ' updated their class on '
        || public.format_lesson_when(v_old_start)
        || ' to '
        || v_duration::text
        || ' minutes.',
      'student_rescheduled'
    );
    return;
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
  elsif v_new_is_booked and v_new_slot_id <> v_old_slot_id then
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

    if not v_pay_later then
      select class_rate_cents into v_rate
      from public.profiles
      where id = v_student_id
      for update;

      v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
      if coalesce(v_old_charge, 0) <> v_new_charge then
        update public.profiles
        set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
        where id = v_student_id;
      end if;

      update public.bookings
      set duration_minutes = v_duration,
          charged_cents = v_new_charge
      where id = p_booking_id;
    else
      update public.bookings
      set duration_minutes = v_duration
      where id = p_booking_id;
    end if;

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
  set slot_id = v_new_slot_id,
      duration_minutes = v_duration
  where id = p_booking_id;

  if not v_pay_later then
    select class_rate_cents into v_rate
    from public.profiles
    where id = v_student_id
    for update;

    v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
    if coalesce(v_old_charge, 0) <> v_new_charge then
      update public.profiles
      set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
      where id = v_student_id;
    end if;

    update public.bookings
    set charged_cents = v_new_charge
    where id = p_booking_id;
  end if;

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

grant execute on function public.student_reschedule_my_booking(uuid, timestamptz, integer) to authenticated;
