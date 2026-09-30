-- Fix admin reschedule failing with
--   duplicate key value violates unique constraint "availability_slots_start_time_uidx"
-- when an open (unbooked) slot row already exists at the new start time.
--
-- Run once in Supabase → SQL Editor.

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

  -- Open slot rows in the new window would collide on start_time; no active booking owns them.
  delete from public.availability_slots s
  where s.id <> v_slot_id
    and s.start_time >= p_start_time
    and s.start_time < v_end
    and not exists (
      select 1
      from public.bookings b
      where b.slot_id = s.id
        and b.status = 'booked'
    );

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

notify pgrst, 'reload schema';
