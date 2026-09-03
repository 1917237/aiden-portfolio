-- Admin credit adjustments, per-student ledger RPC. Run after 43.

alter table public.credit_ledger drop constraint if exists credit_ledger_kind_check;

alter table public.credit_ledger
  add constraint credit_ledger_kind_check
  check (
    kind in ('payment', 'book_hold', 'cancel_refund', 'duration_adjust', 'adjustment')
  );

create or replace function public.admin_adjust_credits(
  p_student_id uuid,
  p_amount_cents integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_amount_cents = 0 then
    raise exception 'Amount cannot be zero';
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student') then
    raise exception 'Student not found';
  end if;

  v_note := coalesce(nullif(trim(p_note), ''), 'Manual adjustment');

  if p_amount_cents > 0 then
    insert into public.payments (student_id, amount_cents, note, created_by)
    values (p_student_id, p_amount_cents, v_note, auth.uid());
  end if;

  update public.profiles
  set credit_balance_cents = credit_balance_cents + p_amount_cents
  where id = p_student_id;

  perform public.append_credit_ledger(
    p_student_id,
    p_amount_cents,
    'adjustment',
    v_note
  );
end;
$$;

grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;

create or replace function public.get_student_credit_history(
  p_student_id uuid,
  p_limit integer default 30
)
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
  where cl.student_id = p_student_id
    and public.is_admin()
  order by cl.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function public.get_student_credit_history(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
