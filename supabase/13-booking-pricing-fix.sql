-- Fixed lesson pricing tiers (run after 12)

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
