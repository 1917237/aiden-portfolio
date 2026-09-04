-- Cancel and reschedule bookings (run after 02-functions.sql)

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select slot_id, status into v_slot_id, v_status
  from public.bookings
  where id = p_booking_id;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false
  where id = v_slot_id;
end;
$$;

create or replace function public.reschedule_booking(
  p_booking_id uuid,
  p_new_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_slot_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select slot_id, status into v_old_slot_id, v_status
  from public.bookings
  where id = p_booking_id;

  if v_old_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if p_new_slot_id = v_old_slot_id then
    return;
  end if;

  update public.availability_slots
  set is_booked = true
  where id = p_new_slot_id and is_booked = false;

  if not found then
    raise exception 'New slot is not available';
  end if;

  update public.availability_slots
  set is_booked = false
  where id = v_old_slot_id;

  update public.bookings
  set slot_id = p_new_slot_id
  where id = p_booking_id;
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.reschedule_booking(uuid, uuid) to authenticated;

-- Admin: book a slot for a student (demo seed + manual booking)
create or replace function public.admin_book_slot(
  p_student_id uuid,
  p_slot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_student_id and role = 'student'
  ) then
    raise exception 'Student not found';
  end if;

  insert into public.bookings (student_id, slot_id)
  values (p_student_id, p_slot_id)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.admin_book_slot(uuid, uuid) to authenticated;

-- Admin: reschedule to any unblocked time (ignores weekly availability)
create or replace function public.admin_reschedule_booking_to_time(
  p_booking_id uuid,
  p_date date,
  p_start_minutes integer,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_duration_minutes integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
  v_m integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select slot_id, status into v_slot_id, v_status
  from public.bookings
  where id = p_booking_id;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if exists (
    select 1
    from public.availability_blockouts
    where blockout_date = p_date and start_minutes is null
  ) then
    raise exception 'That day is fully blocked';
  end if;

  for v_m in
    select generate_series(p_start_minutes, p_start_minutes + p_duration_minutes - 15, 15)
  loop
    if exists (
      select 1
      from public.availability_blockouts
      where blockout_date = p_date and start_minutes = v_m
    ) then
      raise exception 'That time is blocked';
    end if;
  end loop;

  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and b.id <> p_booking_id
      and s.id <> v_slot_id
      and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) then
    raise exception 'Another class is already scheduled at this time';
  end if;

  update public.availability_slots
  set start_time = p_start_time, end_time = p_end_time
  where id = v_slot_id;
end;
$$;

grant execute on function public.admin_reschedule_booking_to_time(uuid, date, integer, timestamptz, timestamptz, integer) to authenticated;
