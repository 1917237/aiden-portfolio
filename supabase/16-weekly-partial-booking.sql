-- Weekly booking: skip unavailable weeks instead of failing the whole series (run after 15)

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
  v_end timestamptz;
  i integer;
  v_skipped integer := 0;
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

  select start_time into v_base_start
  from public.availability_slots
  where id = p_slot_id;

  if v_base_start is null then
    raise exception 'Slot not found';
  end if;

  if p_weekly then
    v_series_id := gen_random_uuid();
  end if;

  for i in 0..case when p_weekly then 3 else 0 end loop
    v_target_start := v_base_start + (i * interval '7 days');
    v_end := v_target_start + make_interval(mins => p_duration_minutes);

    select id, is_booked
    into v_slot_id, v_is_booked
    from public.availability_slots
    where start_time = v_target_start
    for update;

    -- Weekly: skip missing / taken weeks instead of failing the whole series
    if p_weekly then
      if v_slot_id is null or v_is_booked or v_target_start < now() then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_target_start, v_end, '[)')
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    else
      if v_slot_id is null then
        raise exception 'Not all weekly times are available';
      end if;

      if v_is_booked then
        raise exception 'Slot is already booked';
      end if;

      if v_target_start < now() then
        raise exception 'That time has already passed';
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and s.start_time = v_target_start
      ) then
        raise exception 'Slot is already booked';
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_target_start, v_end, '[)')
      ) then
        raise exception 'Another lesson is already scheduled during that time';
      end if;
    end if;

    update public.availability_slots
    set end_time = v_end
    where id = v_slot_id;

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
  end loop;

  if cardinality(v_booking_ids) = 0 then
    raise exception 'None of the weekly times are available';
  end if;

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
