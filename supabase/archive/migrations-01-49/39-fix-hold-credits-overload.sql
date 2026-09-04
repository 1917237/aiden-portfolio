-- Migration 38 added a 4-arg hold_credits_for_lesson while the 3-arg version still exists,
-- so student_book_lesson() can fail with "function is not unique". Run after 38.

drop function if exists public.hold_credits_for_lesson(uuid, integer, boolean);
drop function if exists public.hold_credits_for_lesson(uuid, integer, boolean, uuid);

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

revoke all on function public.hold_credits_for_lesson(uuid, integer, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
