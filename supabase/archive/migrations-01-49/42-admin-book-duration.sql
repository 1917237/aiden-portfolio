-- Admin schedule: selectable lesson length (25/50/80/110). Run after 41.

drop function if exists public.admin_book_slot(uuid, uuid);
drop function if exists public.admin_book_slot(uuid, uuid, integer);

create or replace function public.admin_book_slot(
  p_student_id uuid,
  p_slot_id uuid,
  p_duration_minutes integer default 50
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_start timestamptz;
  v_is_booked boolean;
  v_occupy_end timestamptz;
  v_duration integer;
  v_held integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  v_duration := p_duration_minutes;

  if not exists (
    select 1 from public.profiles where id = p_student_id and role = 'student'
  ) then
    raise exception 'Student not found';
  end if;

  perform public.lock_booking_calendar();

  select start_time, is_booked
  into v_start, v_is_booked
  from public.availability_slots
  where id = p_slot_id
  for update;

  if v_start is null then
    raise exception 'Slot not found';
  end if;

  if v_is_booked then
    raise exception 'Slot is already booked';
  end if;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  if public.booking_occupy_overlaps(v_start, v_occupy_end) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end
  where id = p_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> p_slot_id
    and start_time >= v_start
    and start_time < v_occupy_end;

  v_held := public.hold_credits_for_lesson(p_student_id, v_duration, false);

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    charged_cents
  )
  values (p_student_id, p_slot_id, v_duration, false, nullif(v_held, 0))
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.admin_book_slot(uuid, uuid, integer) to authenticated;

-- Admin reschedule: persist duration + adjust credit hold when length changes.
create or replace function public.admin_reschedule_booking_to_time(
  p_booking_id uuid,
  p_date date,
  p_start_minutes integer,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_duration_minutes integer default null
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
  v_duration integer;
  v_old_charge integer;
  v_new_charge integer;
  v_rate integer;
  v_occupy integer;
  v_end timestamptz;
  v_m integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select
    slot_id,
    status,
    coalesce(duration_minutes, 50),
    student_id,
    charged_cents
  into v_slot_id, v_status, v_duration, v_student_id, v_old_charge
  from public.bookings
  where id = p_booking_id
  for update;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if p_duration_minutes is not null and p_duration_minutes in (25, 50, 80, 110) then
    v_duration := p_duration_minutes;
  end if;

  v_occupy := public.lesson_occupied_minutes(v_duration);
  v_end := p_start_time + make_interval(mins => v_occupy);

  if exists (
    select 1
    from public.availability_blockouts
    where blockout_date = p_date and start_minutes is null
  ) then
    raise exception 'That day is fully blocked';
  end if;

  for v_m in
    select generate_series(p_start_minutes, p_start_minutes + v_occupy - 15, 15)
  loop
    if exists (
      select 1
      from public.availability_blockouts
      where blockout_date = p_date and start_minutes = v_m
    ) then
      raise exception 'That time is blocked';
    end if;
  end loop;

  if public.booking_occupy_overlaps(p_start_time, v_end, p_booking_id) then
    raise exception 'Another class is already scheduled at this time';
  end if;

  update public.availability_slots
  set start_time = p_start_time,
      end_time = v_end
  where id = v_slot_id;

  select class_rate_cents into v_rate
  from public.profiles
  where id = v_student_id
  for update;

  v_new_charge := public.lesson_charge_cents(v_rate, v_duration);

  if coalesce(v_old_charge, 0) <> v_new_charge then
    update public.profiles
    set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
    where id = v_student_id;

    perform public.append_credit_ledger(
      v_student_id,
      coalesce(v_old_charge, 0) - v_new_charge,
      'duration_adjust',
      'Lesson length updated',
      p_booking_id
    );
  end if;

  update public.bookings
  set duration_minutes = v_duration,
      charged_cents = v_new_charge
  where id = p_booking_id;
end;
$$;

grant execute on function public.admin_reschedule_booking_to_time(uuid, date, integer, timestamptz, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
