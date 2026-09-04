-- Credit payment requests + admin confirm/cancel helpers (run after 13)

create table if not exists public.credit_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id)
);

alter table public.credit_requests enable row level security;

drop policy if exists "Students can read own credit requests" on public.credit_requests;
create policy "Students can read own credit requests"
  on public.credit_requests for select
  to authenticated
  using (auth.uid() = student_id or public.is_admin());

drop policy if exists "Admin manages credit requests" on public.credit_requests;
create policy "Admin manages credit requests"
  on public.credit_requests for all
  to authenticated
  using (public.is_admin());

grant select on public.credit_requests to authenticated;

create or replace function public.request_credits(
  p_amount_cents integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can request credits';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into public.credit_requests (student_id, amount_cents, note)
  values (auth.uid(), p_amount_cents, coalesce(nullif(trim(p_note), ''), 'Zelle payment'))
  returning id into v_request_id;

  return v_request_id;
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

  update public.credit_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;

create or replace function public.reject_credit_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select status into v_status
  from public.credit_requests
  where id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Credit request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Request is not pending';
  end if;

  update public.credit_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;

grant execute on function public.request_credits(integer, text) to authenticated;
grant execute on function public.approve_credit_request(uuid) to authenticated;
grant execute on function public.reject_credit_request(uuid) to authenticated;

notify pgrst, 'reload schema';
