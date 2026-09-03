-- Student can ensure an open slot exists before booking (run after 18)

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

notify pgrst, 'reload schema';
