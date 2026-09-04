-- Close student booking bypasses:
-- 1) Drop leftover INSERT policy that allowed direct bookings rows (skipping RPC lock/credits).
-- 2) ensure_open_slot must only mint slots inside tutor weekly hours / extras / not blockouts.
-- 3) Booking inserts/reschedules must fit the tutor schedule (students + cron; admin exempt).
--
-- Run in Supabase SQL Editor after 46.

-- ---------------------------------------------------------------------------
-- 1) No direct client inserts into bookings (RPCs are security definer)
-- ---------------------------------------------------------------------------
drop policy if exists "Students can create bookings" on public.bookings;

revoke insert, update, delete on public.bookings from authenticated;
grant select on public.bookings to authenticated;

-- ---------------------------------------------------------------------------
-- 2) ensure_open_slot: refuse times outside the tutor schedule
-- ---------------------------------------------------------------------------
create or replace function public.tutor_window_is_open(
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_date date;
  v_start_minutes integer;
  v_dow integer;
  v_cursor timestamptz;
begin
  if p_end <= p_start then
    return false;
  end if;

  v_cursor := p_start;
  while v_cursor < p_end loop
    select tutor_date, start_minutes, dow
    into v_date, v_start_minutes, v_dow
    from public.tutor_civil_from_start(v_cursor);

    if v_start_minutes % 15 <> 0 then
      return false;
    end if;

    if not public.tutor_minute_is_open(v_date, v_start_minutes, v_dow) then
      return false;
    end if;

    v_cursor := v_cursor + interval '15 minutes';
  end loop;

  return true;
end;
$$;

revoke all on function public.tutor_window_is_open(timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function public.ensure_open_slot(
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns public.availability_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.availability_slots;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'Invalid slot times';
  end if;

  if p_start_time < now() - interval '1 minute' then
    raise exception 'That time has already passed';
  end if;

  if not public.tutor_window_is_open(p_start_time, p_end_time) then
    raise exception 'That time is not available';
  end if;

  select *
  into v_slot
  from public.availability_slots
  where start_time = p_start_time
  for update;

  if found then
    if v_slot.is_booked then
      raise exception 'Slot is already booked';
    end if;
    if v_slot.end_time < p_end_time then
      update public.availability_slots
      set end_time = p_end_time
      where id = v_slot.id
      returning * into v_slot;
    end if;
    return v_slot;
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and s.start_time = p_start_time
  ) then
    raise exception 'Slot is already booked';
  end if;

  begin
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_start_time, p_end_time, false)
    returning * into v_slot;
  exception
    when unique_violation then
      select *
      into v_slot
      from public.availability_slots
      where start_time = p_start_time
      for update;

      if not found or v_slot.is_booked then
        raise exception 'Slot is already booked';
      end if;
  end;

  return v_slot;
end;
$$;

grant execute on function public.ensure_open_slot(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Final guard on booking rows (covers book + reschedule paths)
--    Admin can still schedule outside weekly hours from the calendar.
-- ---------------------------------------------------------------------------
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

drop trigger if exists bookings_enforce_tutor_schedule on public.bookings;

create trigger bookings_enforce_tutor_schedule
  before insert or update of slot_id, duration_minutes
  on public.bookings
  for each row
  execute function public.enforce_booking_fits_tutor_schedule();

revoke all on function public.enforce_booking_fits_tutor_schedule()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
