-- Per-student class rates + earnings tracking (run after 02-functions.sql)

alter table public.profiles
  add column if not exists class_rate_cents integer not null default 4000
  check (class_rate_cents > 0);

alter table public.bookings
  add column if not exists charged_cents integer check (charged_cents is null or charged_cents > 0);

-- Deduct each student's own rate when a class is confirmed
drop function if exists public.complete_booking(uuid, integer);
drop function if exists public.complete_booking(uuid);

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
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, status
  into v_student_id, v_status
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

  if v_balance < v_rate then
    raise exception 'Student does not have enough credits';
  end if;

  update public.bookings
  set status = 'completed', charged_cents = v_rate, completed_at = now()
  where id = p_booking_id;

  update public.profiles
  set credit_balance_cents = credit_balance_cents - v_rate
  where id = v_student_id;
end;
$$;

grant execute on function public.complete_booking(uuid) to authenticated;

-- Example: change one student's rate to $50
-- update public.profiles set class_rate_cents = 5000 where full_name = 'Alex Chen';
--
-- Example: set default rate for all students
-- update public.profiles set class_rate_cents = 4500 where role = 'student';
