-- Student lesson options: duration, pay later, weekly series (run after 11-booking-fixes.sql)

alter table public.bookings
  add column if not exists duration_minutes integer not null default 60
    check (duration_minutes > 0),
  add column if not exists pay_later boolean not null default false,
  add column if not exists series_id uuid;

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
        and b.id is not null
        and tstzrange(s.start_time, s.end_time, '[)') && tstzrange(v_target_start, v_end, '[)')
    ) then
      raise exception 'Another lesson is already scheduled during that time';
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

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

-- Keep legacy RPC working (60-minute single booking)
create or replace function public.student_book_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  v_ids := public.student_book_lesson(p_slot_id, 60, false, false);
  return v_ids[1];
end;
$$;

grant execute on function public.student_book_slot(uuid) to authenticated;

create or replace function public.complete_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_status text;
  v_balance integer;
  v_rate integer;
  v_duration integer;
  v_pay_later boolean;
  v_charge integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, status, duration_minutes, pay_later
  into v_student_id, v_status, v_duration, v_pay_later
  from public.bookings
  where id = p_booking_id;

  if v_student_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Booking is not active';
  end if;

  select credit_balance_cents, class_rate_cents
  into v_balance, v_rate
  from public.profiles
  where id = v_student_id;

  v_charge := case v_duration
    when 25 then round(v_rate * 0.5)
    when 50 then v_rate
    when 80 then round(v_rate * 1.5)
    when 110 then v_rate * 2
    else v_rate
  end;

  if not v_pay_later and v_balance < v_charge then
    raise exception 'Student does not have enough credits';
  end if;

  update public.bookings
  set status = 'completed', charged_cents = v_charge, completed_at = now()
  where id = p_booking_id;

  if not v_pay_later then
    update public.profiles
    set credit_balance_cents = credit_balance_cents - v_charge
    where id = v_student_id;
  end if;
end;
$$;

grant execute on function public.complete_booking(uuid) to authenticated;

notify pgrst, 'reload schema';
