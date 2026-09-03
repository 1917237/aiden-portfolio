-- Credit ledger + profile timezone. Run after 36.

-- ---------------------------------------------------------------------------
-- Credit ledger
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null,
  kind text not null check (
    kind in ('payment', 'book_hold', 'cancel_refund', 'duration_adjust')
  ),
  description text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_student_created_idx
  on public.credit_ledger (student_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "Students read own credit ledger" on public.credit_ledger;
create policy "Students read own credit ledger"
  on public.credit_ledger for select
  to authenticated
  using (auth.uid() = student_id or public.is_admin());

grant select on public.credit_ledger to authenticated;

create or replace function public.append_credit_ledger(
  p_student_id uuid,
  p_amount_cents integer,
  p_kind text,
  p_description text,
  p_booking_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount_cents = 0 then
    return;
  end if;

  insert into public.credit_ledger (
    student_id,
    amount_cents,
    kind,
    description,
    booking_id
  )
  values (
    p_student_id,
    p_amount_cents,
    p_kind,
    p_description,
    p_booking_id
  );
end;
$$;

revoke all on function public.append_credit_ledger(uuid, integer, text, text, uuid) from public, anon, authenticated;

-- Backfill past payments as ledger entries (skip if already backfilled).
insert into public.credit_ledger (student_id, amount_cents, kind, description, created_at)
select
  p.student_id,
  p.amount_cents,
  'payment',
  coalesce(nullif(trim(p.note), ''), 'Credits added'),
  p.created_at
from public.payments p
where not exists (
  select 1
  from public.credit_ledger cl
  where cl.student_id = p.student_id
    and cl.kind = 'payment'
    and cl.amount_cents = p.amount_cents
    and cl.created_at = p.created_at
);

-- Hold / refund logging
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

  perform public.append_credit_ledger(
    p_student_id,
    -v_charge,
    'book_hold',
    'Reserved for a lesson'
  );

  return v_charge;
end;
$$;

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

create or replace function public.add_student_credits(
  p_student_id uuid,
  p_amount_cents integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into public.payments (student_id, amount_cents, note, created_by)
  values (p_student_id, p_amount_cents, p_note, auth.uid());

  update public.profiles
  set credit_balance_cents = credit_balance_cents + p_amount_cents
  where id = p_student_id;

  perform public.append_credit_ledger(
    p_student_id,
    p_amount_cents,
    'payment',
    coalesce(nullif(trim(p_note), ''), 'Credits added')
  );
end;
$$;

create or replace function public.approve_credit_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_amount integer;
  v_note text;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, amount_cents, note, status
  into v_student_id, v_amount, v_note, v_status
  from public.credit_requests
  where id = p_request_id
  for update;

  if v_student_id is null then
    raise exception 'Credit request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Request is not pending';
  end if;

  insert into public.payments (student_id, amount_cents, note, created_by)
  values (v_student_id, v_amount, v_note, auth.uid());

  update public.profiles
  set credit_balance_cents = credit_balance_cents + v_amount
  where id = v_student_id;

  perform public.append_credit_ledger(
    v_student_id,
    v_amount,
    'payment',
    coalesce(nullif(trim(v_note), ''), 'Credits added')
  );

  update public.credit_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function public.get_my_credit_history(p_limit integer default 30)
returns table (
  id uuid,
  amount_cents integer,
  kind text,
  description text,
  booking_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cl.id,
    cl.amount_cents,
    cl.kind,
    cl.description,
    cl.booking_id,
    cl.created_at
  from public.credit_ledger cl
  where cl.student_id = auth.uid()
  order by cl.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function public.get_my_credit_history(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Profile timezone (saved on account, not just browser)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_timezone text;

create or replace function public.update_my_display_timezone(p_timezone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trimmed text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_trimmed := trim(coalesce(p_timezone, ''));
  if char_length(v_trimmed) < 3 or char_length(v_trimmed) > 64 then
    raise exception 'Invalid timezone';
  end if;

  if v_trimmed !~ '^[A-Za-z0-9_]+/[A-Za-z0-9_+-]+$' then
    raise exception 'Invalid timezone';
  end if;

  update public.profiles
  set display_timezone = v_trimmed
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

grant execute on function public.update_my_display_timezone(text) to authenticated;

-- Log duration credit adjustments on student reschedule (extends 36).
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
  v_pay_later boolean;
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
    b.pay_later,
    b.charged_cents
  into
    v_old_slot_id,
    v_status,
    v_student_id,
    v_old_start,
    v_old_duration,
    v_pay_later,
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

    if not v_pay_later then
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
    else
      update public.bookings
      set duration_minutes = v_duration
      where id = p_booking_id;
    end if;

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

    if not v_pay_later then
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
    else
      update public.bookings
      set duration_minutes = v_duration
      where id = p_booking_id;
    end if;

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

  if not v_pay_later then
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
  end if;

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
