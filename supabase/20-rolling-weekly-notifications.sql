-- Rolling weekly series + student notifications (run after 19)

create table if not exists public.weekly_series (
  id uuid primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  duration_minutes integer not null check (duration_minutes in (25, 50, 80, 110)),
  pay_later boolean not null default false,
  rolling boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists weekly_series_student_idx
  on public.weekly_series (student_id)
  where active = true and rolling = true;

alter table public.weekly_series enable row level security;

drop policy if exists "Students read own weekly series" on public.weekly_series;
create policy "Students read own weekly series"
  on public.weekly_series for select
  to authenticated
  using (auth.uid() = student_id or public.is_admin());

drop policy if exists "Admin manages weekly series" on public.weekly_series;
create policy "Admin manages weekly series"
  on public.weekly_series for all
  to authenticated
  using (public.is_admin());

grant select on public.weekly_series to authenticated;

-- Backfill from existing series bookings
insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
select
  b.series_id,
  b.student_id,
  coalesce(b.duration_minutes, 50),
  coalesce(b.pay_later, false),
  true,
  true
from public.bookings b
where b.series_id is not null
on conflict (id) do nothing;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  kind text not null default 'weekly_skip',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, update on public.notifications to authenticated;

create or replace function public.add_student_notification(
  p_title text,
  p_body text,
  p_kind text default 'weekly_skip'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.notifications (user_id, title, body, kind)
  values (auth.uid(), p_title, p_body, coalesce(nullif(trim(p_kind), ''), 'weekly_skip'))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_my_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.notifications
  set read_at = now()
  where user_id = auth.uid()
    and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.add_student_notification(text, text, text) to authenticated;
grant execute on function public.mark_my_notifications_read() to authenticated;

-- Book one slot into an existing rolling series
create or replace function public.student_book_series_slot(
  p_slot_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean,
  p_series_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_slot_id uuid;
  v_is_booked boolean;
  v_target_start timestamptz;
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  v_booking_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can book lessons';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if v_series.student_id <> auth.uid() then
    raise exception 'Not your weekly series';
  end if;

  if not v_series.active then
    raise exception 'This weekly series is no longer active';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);

  select id, is_booked, start_time
  into v_slot_id, v_is_booked, v_target_start
  from public.availability_slots
  where id = p_slot_id
  for update;

  if v_slot_id is null then
    raise exception 'That time is not available';
  end if;

  if v_is_booked then
    raise exception 'Slot is already booked';
  end if;

  if v_target_start < now() then
    raise exception 'That time has already passed';
  end if;

  v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and tstzrange(
        s.start_time,
        s.start_time + make_interval(mins => public.lesson_occupied_minutes(coalesce(b.duration_minutes, 50))),
        '[)'
      ) && tstzrange(v_target_start, v_occupy_end, '[)')
  ) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end
  where id = v_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_slot_id
    and start_time >= v_target_start
    and start_time < v_occupy_end;

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    series_id
  )
  values (auth.uid(), v_slot_id, p_duration_minutes, p_pay_later, p_series_id)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.student_book_series_slot(uuid, integer, boolean, uuid) to authenticated;

create or replace function public.ensure_weekly_series(
  p_series_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
  values (p_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true)
  on conflict (id) do update
    set active = true,
        rolling = true,
        duration_minutes = excluded.duration_minutes,
        pay_later = excluded.pay_later
  where public.weekly_series.student_id = auth.uid();

  if not exists (
    select 1 from public.weekly_series where id = p_series_id and student_id = auth.uid()
  ) then
    raise exception 'Could not create weekly series';
  end if;

  return p_series_id;
end;
$$;

grant execute on function public.ensure_weekly_series(uuid, integer, boolean) to authenticated;

-- Keep weekly booking creating a rolling series row
create or replace function public.student_book_lesson(
  p_slot_id uuid,
  p_duration_minutes integer default 50,
  p_weekly boolean default false,
  p_pay_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_ids uuid[] := '{}';
  v_series_id uuid;
  v_base_start timestamptz;
  v_target_start timestamptz;
  v_slot_id uuid;
  v_is_booked boolean;
  v_booking_id uuid;
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  i integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can book lessons';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);

  select start_time into v_base_start
  from public.availability_slots
  where id = p_slot_id;

  if v_base_start is null then
    raise exception 'Slot not found';
  end if;

  if p_weekly then
    v_series_id := gen_random_uuid();
    insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
    values (v_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true);
  end if;

  for i in 0..case when p_weekly then 3 else 0 end loop
    v_target_start := v_base_start + (i * interval '7 days');
    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    select id, is_booked
    into v_slot_id, v_is_booked
    from public.availability_slots
    where start_time = v_target_start
    for update;

    if p_weekly then
      if v_slot_id is null or v_is_booked or v_target_start < now() then
        continue;
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and tstzrange(
            s.start_time,
            s.start_time + make_interval(mins => public.lesson_occupied_minutes(coalesce(b.duration_minutes, 50))),
            '[)'
          ) && tstzrange(v_target_start, v_occupy_end, '[)')
      ) then
        continue;
      end if;
    else
      if v_slot_id is null then
        raise exception 'That time is not available';
      end if;

      if v_is_booked then
        raise exception 'Slot is already booked';
      end if;

      if v_target_start < now() then
        raise exception 'That time has already passed';
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and s.start_time = v_target_start
      ) then
        raise exception 'Slot is already booked';
      end if;

      if exists (
        select 1
        from public.bookings b
        join public.availability_slots s on s.id = b.slot_id
        where b.status = 'booked'
          and tstzrange(
            s.start_time,
            s.start_time + make_interval(mins => public.lesson_occupied_minutes(coalesce(b.duration_minutes, 50))),
            '[)'
          ) && tstzrange(v_target_start, v_occupy_end, '[)')
      ) then
        raise exception 'Another lesson is already scheduled during that time';
      end if;
    end if;

    update public.availability_slots
    set end_time = v_occupy_end
    where id = v_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_slot_id
      and start_time >= v_target_start
      and start_time < v_occupy_end;

    insert into public.bookings (
      student_id,
      slot_id,
      duration_minutes,
      pay_later,
      series_id
    )
    values (auth.uid(), v_slot_id, p_duration_minutes, p_pay_later, v_series_id)
    returning id into v_booking_id;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);
  end loop;

  if cardinality(v_booking_ids) = 0 then
    raise exception 'None of the weekly times are available';
  end if;

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
