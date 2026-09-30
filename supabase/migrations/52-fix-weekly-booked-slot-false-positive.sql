-- Fix false "another student just booked this slot" on weekly / pay-later book.
--
-- Cause: student_book_weekly_slots (and system_book_series_slot) set
-- availability_slots.is_booked = true BEFORE inserting the booking. The
-- on_booking_created → mark_slot_booked trigger then tries
--   update ... where is_booked = false
-- finds 0 rows, and raises "Slot is already booked" — which the UI maps to
-- "Sorry, another student just booked this slot."
--
-- Also reclaim orphaned is_booked flags (no active booking) so green grid cells
-- that only exist as virtual slots can still materialize.
--
-- Run once in Supabase → SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Trigger: allow pre-marked slots when this insert is the only booking
-- ---------------------------------------------------------------------------
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

  if found then
    return new;
  end if;

  -- Already flagged booked (RPC pre-marked). Conflict only if another booking owns it.
  if exists (
    select 1
    from public.bookings
    where slot_id = new.slot_id
      and status = 'booked'
      and id <> new.id
  ) then
    raise exception 'Slot is already booked';
  end if;

  update public.availability_slots
  set is_booked = true
  where id = new.slot_id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) ensure_open_slot: reclaim orphans so green cells stay bookable
-- ---------------------------------------------------------------------------
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
      if exists (
        select 1
        from public.bookings b
        where b.slot_id = v_slot.id
          and b.status = 'booked'
      ) then
        raise exception 'Slot is already booked';
      end if;

      update public.availability_slots
      set is_booked = false
      where id = v_slot.id
      returning * into v_slot;
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

      if not found then
        raise exception 'Slot is already booked';
      end if;

      if v_slot.is_booked then
        if exists (
          select 1
          from public.bookings b
          where b.slot_id = v_slot.id
            and b.status = 'booked'
        ) then
          raise exception 'Slot is already booked';
        end if;

        update public.availability_slots
        set is_booked = false
        where id = v_slot.id
        returning * into v_slot;
      end if;
  end;

  return v_slot;
end;
$$;

grant execute on function public.ensure_open_slot(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Weekly book: let the trigger set is_booked (same as single-lesson path)
-- ---------------------------------------------------------------------------
create or replace function public.student_book_weekly_slots(
  p_slot_ids uuid[],
  p_duration_minutes integer,
  p_pay_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_slot_id uuid;
  v_booking_ids uuid[] := '{}';
  v_booking_id uuid;
  v_is_booked boolean;
  v_target_start timestamptz;
  v_occupy_mins integer;
  v_occupy_end timestamptz;
  v_held integer;
  v_student_name text;
  v_times text := '';
  v_i integer;
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

  if p_slot_ids is null or cardinality(p_slot_ids) = 0 then
    raise exception 'No weekly times to book';
  end if;

  perform public.lock_booking_calendar();

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);
  v_series_id := gen_random_uuid();

  insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
  values (v_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true);

  for v_i in 1..cardinality(p_slot_ids) loop
    v_slot_id := p_slot_ids[v_i];

    select id, is_booked, start_time
    into v_slot_id, v_is_booked, v_target_start
    from public.availability_slots
    where id = v_slot_id
    for update;

    if v_slot_id is null then
      raise exception 'That time is not available';
    end if;

    if v_is_booked then
      if exists (
        select 1 from public.bookings
        where slot_id = v_slot_id and status = 'booked'
      ) then
        raise exception 'Sorry, another student just booked this slot.';
      end if;
      update public.availability_slots
      set is_booked = false
      where id = v_slot_id;
    end if;

    if v_target_start < now() then
      raise exception 'That time has already passed';
    end if;

    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
      raise exception 'Sorry, another student just booked this slot.';
    end if;

    -- Do not set is_booked here — on_booking_created / mark_slot_booked owns that.
    update public.availability_slots
    set end_time = v_occupy_end
    where id = v_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_slot_id
      and start_time >= v_target_start
      and start_time < v_occupy_end;

    v_held := public.hold_credits_for_lesson(auth.uid(), p_duration_minutes, p_pay_later);

    insert into public.bookings (
      student_id,
      slot_id,
      duration_minutes,
      pay_later,
      series_id,
      charged_cents
    )
    values (
      auth.uid(),
      v_slot_id,
      p_duration_minutes,
      p_pay_later,
      v_series_id,
      nullif(v_held, 0)
    )
    returning id into v_booking_id;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    if v_times = '' then
      v_times := public.format_lesson_when(v_target_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_target_start);
    end if;
  end loop;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  perform public.notify_admins(
    'New weekly series booked',
    coalesce(v_student_name, 'A student')
      || ' booked a weekly series ('
      || cardinality(v_booking_ids)::text
      || ' lessons, '
      || p_duration_minutes::text
      || ' min'
      || case when p_pay_later then ', pay later' else '' end
      || '): '
      || v_times
      || '.',
    'booking_weekly'
  );

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_weekly_slots(uuid[], integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Rolling / system book: same pre-mark fix
-- ---------------------------------------------------------------------------
create or replace function public.system_book_series_slot(
  p_series_id uuid,
  p_start timestamptz,
  p_notify boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_slot_id uuid;
  v_is_booked boolean;
  v_occupy_mins integer;
  v_occupy_end timestamptz;
  v_booking_id uuid;
  v_student_name text;
  v_held integer;
begin
  perform public.lock_booking_calendar();

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if not v_series.active or not v_series.rolling then
    raise exception 'This weekly series is no longer active';
  end if;

  if p_start < now() then
    raise exception 'That time has already passed';
  end if;

  if not public.tutor_start_fits_duration(p_start, v_series.duration_minutes) then
    raise exception 'That time is not available';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(v_series.duration_minutes);
  v_occupy_end := p_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_start, v_occupy_end) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  select id, is_booked
  into v_slot_id, v_is_booked
  from public.availability_slots
  where start_time = p_start
  for update;

  if v_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_start, v_occupy_end, false)
    returning id into v_slot_id;
    v_is_booked := false;
  elsif v_is_booked then
    if exists (
      select 1 from public.bookings
      where slot_id = v_slot_id and status = 'booked'
    ) then
      raise exception 'Slot is already booked';
    end if;
    update public.availability_slots
    set is_booked = false
    where id = v_slot_id;
  end if;

  update public.availability_slots
  set end_time = v_occupy_end
  where id = v_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_slot_id
    and start_time >= p_start
    and start_time < v_occupy_end;

  v_held := public.hold_credits_for_lesson(
    v_series.student_id,
    v_series.duration_minutes,
    v_series.pay_later
  );

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    series_id,
    charged_cents
  )
  values (
    v_series.student_id,
    v_slot_id,
    v_series.duration_minutes,
    v_series.pay_later,
    p_series_id,
    nullif(v_held, 0)
  )
  returning id into v_booking_id;

  if p_notify then
    select full_name into v_student_name
    from public.profiles
    where id = v_series.student_id;

    perform public.notify_admins(
      'New weekly class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly class for '
        || public.format_lesson_when(p_start)
        || ' ('
        || v_series.duration_minutes::text
        || ' min'
        || case when v_series.pay_later then ', pay later' else '' end
        || ').',
      'booking_weekly'
    );
  end if;

  return v_booking_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) One-time cleanup of orphaned booked flags
-- ---------------------------------------------------------------------------
update public.availability_slots s
set is_booked = false
where s.is_booked = true
  and not exists (
    select 1
    from public.bookings b
    where b.slot_id = s.id
      and b.status = 'booked'
  );

notify pgrst, 'reload schema';
