-- One-off availability additions for specific dates (on top of weekly template)
-- Run in Supabase SQL Editor after 04-weekly-schedule.sql

create table public.date_availability (
  availability_date date not null,
  start_minutes smallint not null check (start_minutes >= 0 and start_minutes < 1440),
  primary key (availability_date, start_minutes)
);

alter table public.date_availability enable row level security;

grant select on public.date_availability to authenticated;
grant all on public.date_availability to authenticated;

create policy "Anyone logged in can view date availability"
  on public.date_availability for select
  to authenticated
  using (true);

create policy "Admin manages date availability"
  on public.date_availability for all
  to authenticated
  using (public.is_admin());
