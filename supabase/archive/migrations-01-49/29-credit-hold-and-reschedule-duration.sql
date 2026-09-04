-- Hold credits at book time (allow negative); refund on cancel; no double-charge on confirm.
-- Also fix admin reschedule to use the booking's real duration. Run after 28.

create or replace function public.lesson_charge_cents(
  p_class_rate_cents integer,
  p_duration_minutes integer
)
returns integer
language sql
immutable
as $$
  select case p_duration_minutes
    when 25 then round(p_class_rate_cents * 0.5)::integer
    when 50 then p_class_rate_cents
    when 80 then round(p_class_rate_cents * 1.5)::integer
    when 110 then (p_class_rate_cents * 2)
    else p_class_rate_cents
  end;
$$;

-- Deduct lesson cost now (may go negative). Returns amount held (0 for pay later).
create or replace function public.hold_credits_for_lesson(
  p_student_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
  v_charge integer;
begin
  if p_pay_later then
    return 0;
  end if;

  select class_rate_cents into v_rate
  from public.profiles
  where id = p_student_id
  for update;

  if v_rate is null then
    raise exception 'Student not found';
  end if;

  v_charge := public.lesson_charge_cents(v_rate, p_duration_minutes);

  update public.profiles
  set credit_balance_cents = credit_balance_cents - v_charge
  where id = p_student_id;

  return v_charge;
end;
$$;

-- Refund a held amount when a booked lesson is cancelled.
create or replace function public.release_booking_credits(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_status text;
  v_pay_later boolean;
  v_charged integer;
begin
  select student_id, status, pay_later, charged_cents
  into v_student_id, v_status, v_pay_later, v_charged
  from public.bookings
  where id = p_booking_id
  for update;

  if v_student_id is null then
    return 0;
  end if;

  if v_pay_later or v_charged is null or v_charged <= 0 then
    return 0;
  end if;

  -- Only refund holds on active (or just-cancelled) bookings that still show a hold.
  update public.profiles
  set credit_balance_cents = credit_balance_cents + v_charged
  where id = v_student_id;

  update public.bookings
  set charged_cents = null
  where id = p_booking_id;

  return v_charged;
end;
$$;

create or replace function public.complete_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_status text;
  v_rate integer;
  v_duration integer;
  v_pay_later boolean;
  v_charge integer;
  v_already_held integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, status, duration_minutes, pay_later, charged_cents
  into v_student_id, v_status, v_duration, v_pay_later, v_already_held
  from public.bookings
  where id = p_booking_id
  for update;

  if v_student_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Booking is not active';
  end if;

  select class_rate_cents into v_rate
  from public.profiles
  where id = v_student_id;

  v_charge := public.lesson_charge_cents(v_rate, coalesce(v_duration, 50));

  -- Credits were already held at book time for non-pay-later lessons.
  if v_already_held is not null and v_already_held > 0 then
    update public.bookings
    set status = 'completed',
        charged_cents = v_already_held,
        completed_at = now()
    where id = p_booking_id;
    return;
  end if;

  update public.bookings
  set status = 'completed',
      charged_cents = v_charge,
      completed_at = now()
  where id = p_booking_id;

  if not v_pay_later then
    update public.profiles
    set credit_balance_cents = credit_balance_cents - v_charge
    where id = v_student_id;
  end if;
end;
$$;

grant execute on function public.complete_booking(uuid) to authenticated;
grant execute on function public.lesson_charge_cents(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel paths: refund hold
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking_id uuid)
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
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
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

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  perform public.release_booking_credits(p_booking_id);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false,
      end_time = v_start + interval '60 minutes'
  where id = v_slot_id;

  perform public.restore_open_starts_in_range(v_start, v_occupy_end);

  perform public.notify_user(
    v_student_id,
    'Class cancelled',
    'Your class on ' || public.format_lesson_when(v_start) || ' was cancelled by your tutor.',
    'class_cancelled'
  );
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;

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

  perform public.release_booking_credits(p_booking_id);

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

grant execute on function public.student_cancel_my_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Book paths: hold credits after insert
-- ---------------------------------------------------------------------------
create or replace function public.student_book_series_slot(
  p_slot_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean,
  p_series_id uuid,
  p_notify boolean default true
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
  v_target_start timestamptz;
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  v_booking_id uuid;
  v_student_name text;
  v_held integer;
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

  perform public.lock_booking_calendar();

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if v_series.student_id <> auth.uid() then
    raise exception 'Not your weekly series';
  end if;

  if not v_series.active then
    raise exception 'This weekly series is no longer active';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);

  select id, is_booked, start_time
  into v_slot_id, v_is_booked, v_target_start
  from public.availability_slots
  where id = p_slot_id
  for update;

  if v_slot_id is null then
    raise exception 'That time is not available';
  end if;

  if v_is_booked then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

  if v_target_start < now() then
    raise exception 'That time has already passed';
  end if;

  v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

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
    p_series_id,
    nullif(v_held, 0)
  )
  returning id into v_booking_id;

  if p_notify then
    select full_name into v_student_name
    from public.profiles
    where id = auth.uid();

    perform public.notify_admins(
      'New weekly class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly class for '
        || public.format_lesson_when(v_target_start)
        || ' ('
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || ').',
      'booking_weekly'
    );
  end if;

  return v_booking_id;
end;
$$;

grant execute on function public.student_book_series_slot(uuid, integer, boolean, uuid, boolean) to authenticated;

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
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  i integer;
  v_student_name text;
  v_times text := '';
  v_booked_count integer := 0;
  v_held integer;
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

  perform public.lock_booking_calendar();

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);

  select start_time into v_base_start
  from public.availability_slots
  where id = p_slot_id;

  if v_base_start is null then
    raise exception 'Slot not found';
  end if;

  if p_weekly then
    v_series_id := gen_random_uuid();
    insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
    values (v_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true);
  end if;

  for i in 0..case when p_weekly then 3 else 0 end loop
    v_target_start := public.add_weeks_tutor_wall(v_base_start, i);
    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    select id, is_booked
    into v_slot_id, v_is_booked
    from public.availability_slots
    where start_time = v_target_start
    for update;

    if p_weekly then
      if v_slot_id is null or v_is_booked or v_target_start < now() then
        continue;
      end if;

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
        continue;
      end if;
    else
      if v_slot_id is null then
        raise exception 'That time is not available';
      end if;

      if v_is_booked then
        raise exception 'Sorry, another student just booked this slot.';
      end if;

      if v_target_start < now() then
        raise exception 'That time has already passed';
      end if;

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
        raise exception 'Sorry, another student just booked this slot.';
      end if;
    end if;

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
    v_booked_count := v_booked_count + 1;
    if v_times = '' then
      v_times := public.format_lesson_when(v_target_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_target_start);
    end if;
  end loop;

  if cardinality(v_booking_ids) = 0 then
    raise exception 'None of the weekly times are available';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  if p_weekly then
    perform public.notify_admins(
      'New weekly series booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly series ('
        || v_booked_count::text
        || ' lessons, '
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || '): '
        || v_times
        || '.',
      'booking_weekly'
    );
  else
    perform public.notify_admins(
      'New class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a single class for '
        || v_times
        || ' ('
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || ').',
      'booking_single'
    );
  end if;

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

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
    raise exception 'Slot is already booked';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end,
      is_booked = true
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

revoke all on function public.system_book_series_slot(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.hold_credits_for_lesson(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.release_booking_credits(uuid) from public, anon, authenticated;

-- Patch stop series to refund holds when cancelling future lessons
create or replace function public.stop_my_weekly_series(
  p_series_id uuid,
  p_mode text,
  p_stop_on_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_student_name text;
  v_cutoff timestamptz;
  v_mode text;
  v_booking record;
  v_occupy_end timestamptz;
  v_cancelled integer := 0;
  v_kept integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_mode := lower(trim(coalesce(p_mode, '')));
  if v_mode not in ('now', 'on_date') then
    raise exception 'Invalid stop mode';
  end if;

  if v_mode = 'on_date' and p_stop_on_date is null then
    raise exception 'Pick a stop date';
  end if;

  if v_mode = 'on_date' and p_stop_on_date < (timezone('America/Los_Angeles', now()))::date then
    raise exception 'Stop date must be today or later';
  end if;

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if v_series.student_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not your weekly series';
  end if;

  if not v_series.active then
    raise exception 'This weekly series is already stopped';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_series.student_id;

  if v_mode = 'now' then
    v_cutoff := now();
  else
    v_cutoff := ((p_stop_on_date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles');
  end if;

  perform public.lock_booking_calendar();

  for v_booking in
    select
      b.id as booking_id,
      b.slot_id,
      b.duration_minutes,
      s.start_time
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.series_id = p_series_id
      and b.status = 'booked'
      and s.start_time >= v_cutoff
    order by s.start_time
    for update of b
  loop
    v_occupy_end := v_booking.start_time + make_interval(
      mins => public.lesson_occupied_minutes(coalesce(v_booking.duration_minutes, 50))
    );

    perform public.release_booking_credits(v_booking.booking_id);

    update public.bookings
    set status = 'cancelled'
    where id = v_booking.booking_id;

    update public.availability_slots
    set is_booked = false,
        end_time = v_booking.start_time + interval '60 minutes'
    where id = v_booking.slot_id;

    perform public.restore_open_starts_in_range(v_booking.start_time, v_occupy_end);
    v_cancelled := v_cancelled + 1;
  end loop;

  select count(*)::integer into v_kept
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked'
    and s.start_time >= now();

  update public.weekly_series
  set active = false,
      rolling = false
  where id = p_series_id;

  if v_mode = 'now' then
    perform public.notify_admins(
      'Weekly series stopped',
      coalesce(v_student_name, 'A student')
        || ' stopped their weekly series now. Cancelled '
        || v_cancelled::text
        || ' upcoming class'
        || case when v_cancelled = 1 then '' else 'es' end
        || '.',
      'weekly_stopped'
    );
  else
    perform public.notify_admins(
      'Weekly series ending',
      coalesce(v_student_name, 'A student')
        || ' will end their weekly series after '
        || to_char(p_stop_on_date, 'Mon FMDD, YYYY')
        || '. Cancelled '
        || v_cancelled::text
        || ' class'
        || case when v_cancelled = 1 then '' else 'es' end
        || ' after that date'
        || case when v_kept > 0 then ' (' || v_kept::text || ' still scheduled through the stop date)' else '' end
        || '.',
      'weekly_stopped'
    );
  end if;

  return jsonb_build_object(
    'series_id', p_series_id,
    'mode', v_mode,
    'stop_on_date', p_stop_on_date,
    'cancelled_count', v_cancelled,
    'kept_count', v_kept
  );
end;
$$;

grant execute on function public.stop_my_weekly_series(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin reschedule: use booking duration + occupy block
-- ---------------------------------------------------------------------------
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
  v_duration integer;
  v_occupy integer;
  v_end timestamptz;
  v_m integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select slot_id, status, coalesce(duration_minutes, 50)
  into v_slot_id, v_status, v_duration
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
end;
$$;

grant execute on function public.admin_reschedule_booking_to_time(uuid, date, integer, timestamptz, timestamptz, integer) to authenticated;

notify pgrst, 'reload schema';
