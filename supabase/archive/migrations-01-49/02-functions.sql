-- Run this in Supabase SQL Editor after 01-schema.sql

-- Admin: add Zelle credits to a student (records payment + updates balance)
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
end;
$$;

grant execute on function public.add_student_credits(uuid, integer, text) to authenticated;

-- complete_booking is defined in 08-student-rates.sql (uses each student's class_rate_cents)
