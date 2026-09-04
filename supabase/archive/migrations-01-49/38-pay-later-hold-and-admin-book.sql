-- Pay-later and admin bookings reserve credits at book time (balance may go negative).
-- Run after 37.

-- ---------------------------------------------------------------------------
-- Hold credits for every booking (pay_later only affects the label on the booking)
-- ---------------------------------------------------------------------------
create or replace function public.hold_credits_for_lesson(
  p_student_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
  v_charge integer;
  v_description text;
begin
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

  v_description := case
    when p_pay_later then 'Reserved for lesson (pay before class)'
    else 'Reserved for a lesson'
  end;

  perform public.append_credit_ledger(
    p_student_id,
    -v_charge,
    'book_hold',
    v_description
  );

  return v_charge;
end;
$$;

-- Refund any held amount when a booked lesson is cancelled.
create or replace function public.release_booking_credits(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_status text;
  v_charged integer;
  v_duration integer;
  v_rate integer;
  v_booking_created timestamptz;
begin
  select
    b.student_id,
    b.status,
    b.charged_cents,
    coalesce(b.duration_minutes, 50),
    b.created_at
  into v_student_id, v_status, v_charged, v_duration, v_booking_created
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if v_student_id is null then
    return 0;
  end if;

  if exists (
    select 1
    from public.credit_ledger cl
    where cl.booking_id = p_booking_id
      and cl.kind = 'cancel_refund'
  ) then
    return 0;
  end if;

  if v_charged is null or v_charged <= 0 then
    if v_status <> 'booked' then
      return 0;
    end if;

    select class_rate_cents into v_rate
    from public.profiles
    where id = v_student_id;

    v_charged := public.lesson_charge_cents(v_rate, v_duration);

    if not exists (
      select 1
      from public.credit_ledger cl
      where cl.student_id = v_student_id
        and cl.kind = 'book_hold'
        and cl.amount_cents = -v_charged
        and cl.created_at between v_booking_created - interval '2 minutes'
                            and v_booking_created + interval '2 minutes'
    ) then
      return 0;
    end if;
  end if;

  update public.profiles
  set credit_balance_cents = credit_balance_cents + v_charged
  where id = v_student_id;

  update public.bookings
  set charged_cents = null
  where id = p_booking_id;

  perform public.append_credit_ledger(
    v_student_id,
    v_charged,
    'cancel_refund',
    'Refunded for cancelled lesson',
    p_booking_id
  );

  return v_charged;
end;
$$;

revoke all on function public.release_booking_credits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin-scheduled lessons hold credits and appear in credit history
-- ---------------------------------------------------------------------------
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
  v_start timestamptz;
  v_is_booked boolean;
  v_occupy_end timestamptz;
  v_duration integer := 50;
  v_held integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

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

grant execute on function public.admin_book_slot(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Student reschedule: adjust holds for pay-later bookings too
-- ---------------------------------------------------------------------------
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
    b.charged_cents
  into
    v_old_slot_id,
    v_status,
    v_student_id,
    v_old_start,
    v_old_duration,
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
  set charged_cents = v_new_charge
  where id = p_booking_id;

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

notify pgrst, 'reload schema';
