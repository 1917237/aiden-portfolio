-- Fix student booking + duplicate open slots (run after 06-booking-actions.sql)

-- Trigger must bypass RLS so students can book (only admins had UPDATE on slots)
create or replace function public.mark_slot_booked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.availability_slots
  set is_booked = true
  where id = new.slot_id and is_booked = false;

  if not found then
    raise exception 'Slot is already booked';
  end if;

  return new;
end;
$$;

-- Atomic student booking with overlap checks
create or replace function public.student_book_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_start timestamptz;
  v_is_booked boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can book lessons';
  end if;

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

  if v_start < now() then
    raise exception 'That time has already passed';
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and s.start_time = v_start
  ) then
    raise exception 'Slot is already booked';
  end if;

  insert into public.bookings (student_id, slot_id)
  values (auth.uid(), p_slot_id)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.student_book_slot(uuid) to authenticated;

-- Remove duplicate open slots when that time is already taken
delete from public.availability_slots u
where u.is_booked = false
  and exists (
    select 1
    from public.availability_slots o
    where o.start_time = u.start_time
      and o.id <> u.id
      and (
        o.is_booked = true
        or exists (
          select 1
          from public.bookings b
          where b.slot_id = o.id and b.status = 'booked'
        )
      )
  );
