-- Critical fixes: unique slot starts, overlap booking lock, cancel restores opens,
-- signup cannot self-assign admin. Run after 23.

-- ---------------------------------------------------------------------------
-- 1) Unique start_time (dedupe first)
-- ---------------------------------------------------------------------------
delete from public.availability_slots a
using public.availability_slots b
where a.start_time = b.start_time
  and a.id <> b.id
  and (
    (a.is_booked = false and b.is_booked = true)
    or (a.is_booked = b.is_booked and a.id > b.id)
  );

create unique index if not exists availability_slots_start_time_uidx
  on public.availability_slots (start_time);

-- ---------------------------------------------------------------------------
-- 2) Signup always creates a student (never admin from client metadata)
-- ---------------------------------------------------------------------------
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
    'student'
  );
  return new;
end;
$$;

-- Soft safety: only an existing admin may promote someone to admin
create or replace function public.prevent_unauthorized_admin_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' and (tg_op = 'INSERT' or old.role is distinct from 'admin') then
    if auth.uid() is null or not public.is_admin() then
      -- Allow bootstrap when no admin exists yet (first admin via SQL Editor)
      if exists (select 1 from public.profiles where role = 'admin') then
        raise exception 'Not authorized to assign admin role';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_admin_promotion on public.profiles;
create trigger profiles_prevent_admin_promotion
  before insert or update of role on public.profiles
  for each row execute function public.prevent_unauthorized_admin_promotion();

-- ---------------------------------------------------------------------------
-- 3) Serialize booking mutations + overlap helper
-- ---------------------------------------------------------------------------
create or replace function public.lock_booking_calendar()
returns void
language plpgsql
as $$
begin
  -- Single-tutor calendar: serialize book/cancel so overlap checks can't race
  perform pg_advisory_xact_lock(87201442);
end;
$$;

create or replace function public.booking_occupy_overlaps(
  p_start timestamptz,
  p_occupy_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(
        s.start_time,
        s.start_time + make_interval(
          mins => public.lesson_occupied_minutes(coalesce(b.duration_minutes, 50))
        ),
        '[)'
      ) && tstzrange(p_start, p_occupy_end, '[)')
  );
$$;

create or replace function public.restore_open_starts_in_range(
  p_start timestamptz,
  p_occupy_end timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor timestamptz;
  v_count integer := 0;
  v_slot_id uuid;
  v_is_booked boolean;
begin
  v_cursor := p_start;
  while v_cursor < p_occupy_end loop
    -- Skip if another active booking still occupies this start
    if not public.booking_occupy_overlaps(
      v_cursor,
      v_cursor + interval '15 minutes'
    ) then
      select id, is_booked
      into v_slot_id, v_is_booked
      from public.availability_slots
      where start_time = v_cursor;

      if v_slot_id is null then
        insert into public.availability_slots (start_time, end_time, is_booked)
        values (v_cursor, v_cursor + interval '60 minutes', false);
        v_count := v_count + 1;
      elsif v_is_booked = false then
        update public.availability_slots
        set end_time = greatest(end_time, v_cursor + interval '60 minutes')
        where id = v_slot_id;
        v_count := v_count + 1;
      end if;
    end if;

    v_cursor := v_cursor + interval '15 minutes';
  end loop;

  return v_count;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_start, v_duration
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false,
      end_time = v_start + interval '60 minutes'
  where id = v_slot_id;

  -- Put back every 15-min open start that booking had cleared
  perform public.restore_open_starts_in_range(v_start, v_occupy_end);

  perform public.notify_user(
    v_student_id,
    'Class cancelled',
    'Your class on ' || public.format_lesson_when(v_start) || ' was cancelled by your tutor.',
    'class_cancelled'
  );
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Booking RPCs: lock calendar before overlap check
-- ---------------------------------------------------------------------------
create or replace function public.student_book_series_slot(
  p_slot_id uuid,
  p_duration_minutes integer,
  p_pay_later boolean,
  p_series_id uuid,
  p_notify boolean default true
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
  v_student_name text;
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

  perform public.lock_booking_calendar();

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

  if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
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

  if p_notify then
    select full_name into v_student_name
    from public.profiles
    where id = auth.uid();

    perform public.notify_admins(
      'New weekly class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly class for '
        || public.format_lesson_when(v_target_start)
        || ' ('
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || ').',
      'booking_weekly'
    );
  end if;

  return v_booking_id;
end;
$$;

grant execute on function public.student_book_series_slot(uuid, integer, boolean, uuid, boolean) to authenticated;

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
  v_student_name text;
  v_times text := '';
  v_booked_count integer := 0;
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

  perform public.lock_booking_calendar();

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

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
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

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
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
    v_booked_count := v_booked_count + 1;
    if v_times = '' then
      v_times := public.format_lesson_when(v_target_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_target_start);
    end if;
  end loop;

  if cardinality(v_booking_ids) = 0 then
    raise exception 'None of the weekly times are available';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  if p_weekly then
    perform public.notify_admins(
      'New weekly series booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly series ('
        || v_booked_count::text
        || ' lessons, '
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || '): '
        || v_times
        || '.',
      'booking_weekly'
    );
  else
    perform public.notify_admins(
      'New class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a single class for '
        || v_times
        || ' ('
        || p_duration_minutes::text
        || ' min'
        || case when p_pay_later then ', pay later' else '' end
        || ').',
      'booking_single'
    );
  end if;

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_lesson(uuid, integer, boolean, boolean) to authenticated;

create or replace function public.admin_book_slot(
  p_student_id uuid,
  p_slot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_start timestamptz;
  v_is_booked boolean;
  v_occupy_end timestamptz;
  v_duration integer := 50;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if not exists (
    select 1 from public.profiles where id = p_student_id and role = 'student'
  ) then
    raise exception 'Student not found';
  end if;

  perform public.lock_booking_calendar();

  select start_time, is_booked
  into v_start, v_is_booked
  from public.availability_slots
  where id = p_slot_id
  for update;

  if v_start is null then
    raise exception 'Slot not found';
  end if;

  if v_is_booked then
    raise exception 'Slot is already booked';
  end if;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  if public.booking_occupy_overlaps(v_start, v_occupy_end) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end
  where id = p_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> p_slot_id
    and start_time >= v_start
    and start_time < v_occupy_end;

  insert into public.bookings (student_id, slot_id, duration_minutes)
  values (p_student_id, p_slot_id, v_duration)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function public.admin_book_slot(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
