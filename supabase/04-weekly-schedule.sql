-- Weekly When2Meet-style schedule + date blockouts
-- Run in Supabase SQL Editor after 03-fix-permissions.sql

create table public.weekly_availability (
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minutes smallint not null check (start_minutes >= 0 and start_minutes < 1440),
  primary key (day_of_week, start_minutes)
);

create table public.availability_blockouts (
  id uuid primary key default gen_random_uuid(),
  blockout_date date not null,
  start_minutes smallint,
  created_at timestamptz not null default now()
);

create unique index availability_blockouts_unique
  on public.availability_blockouts (blockout_date, coalesce(start_minutes, -1));

alter table public.weekly_availability enable row level security;
alter table public.availability_blockouts enable row level security;

grant select on public.weekly_availability to authenticated;
grant select on public.availability_blockouts to authenticated;
grant all on public.weekly_availability to authenticated;
grant all on public.availability_blockouts to authenticated;

create policy "Anyone logged in can view weekly template"
  on public.weekly_availability for select
  to authenticated
  using (true);

create policy "Admin manages weekly template"
  on public.weekly_availability for all
  to authenticated
  using (public.is_admin());

create policy "Anyone logged in can view blockouts"
  on public.availability_blockouts for select
  to authenticated
  using (true);

create policy "Admin manages blockouts"
  on public.availability_blockouts for all
  to authenticated
  using (public.is_admin());
