-- Cancel must refund credit holds (including pay-later). Run after 39.
--
-- Migration 37 skipped refunds when pay_later = true. Migration 38 fixed that but
-- may not have been applied; this re-asserts correct behavior and adds a ledger
-- fallback when charged_cents was not stored on the booking row.

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

    -- Only infer a hold when the ledger shows one near booking time.
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

notify pgrst, 'reload schema';
