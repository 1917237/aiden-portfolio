-- Tutoring system schema (run once in Supabase SQL Editor)

-- Profiles linked to Supabase Auth users
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  credit_balance_cents integer not null default 0 check (credit_balance_cents >= 0),
  created_at timestamptz not null default now()
);

-- Time slots you open for booking
create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_booked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint valid_slot_times check (end_time > start_time)
);

-- Student bookings
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  slot_id uuid not null unique references public.availability_slots (id) on delete cascade,
  status text not null default 'booked' check (status in ('booked', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Manual Zelle / payment top-ups (you add these in admin)
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  method text not null default 'zelle',
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mark slot as booked when a booking is created
create or replace function public.mark_slot_booked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.availability_slots
  set is_booked = true
  where id = new.slot_id and is_booked = false;

  if not found then
    raise exception 'Slot is already booked';
  end if;

  return new;
end;
$$;

create trigger on_booking_created
  after insert on public.bookings
  for each row execute function public.mark_slot_booked();

-- Helper: check if current user is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.availability_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

-- Profiles: users see own row; admin sees all
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Admin can update profiles"
  on public.profiles for update
  using (public.is_admin());

-- Slots: everyone logged in can see slots; only admin can create/edit
create policy "Logged in users can view slots"
  on public.availability_slots for select
  to authenticated
  using (true);

create policy "Admin manages slots"
  on public.availability_slots for all
  using (public.is_admin());

-- Bookings: students see own; admin sees all; students can book
create policy "Users can view own bookings"
  on public.bookings for select
  using (auth.uid() = student_id or public.is_admin());

create policy "Students can create bookings"
  on public.bookings for insert
  to authenticated
  with check (auth.uid() = student_id);

create policy "Admin manages bookings"
  on public.bookings for update
  using (public.is_admin());

-- Payments: students see own; admin manages
create policy "Users can view own payments"
  on public.payments for select
  using (auth.uid() = student_id or public.is_admin());

create policy "Admin manages payments"
  on public.payments for all
  using (public.is_admin());
