-- Atomic weekly book, auto-stop empty series, credit-request notify, delete-all notifs.
-- Run after 29.

-- ---------------------------------------------------------------------------
-- Deactivate rolling series when no future booked lessons remain
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_series_if_no_future(p_series_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_future integer;
begin
  if p_series_id is null then
    return false;
  end if;

  select count(*)::integer into v_future
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked'
    and s.start_time >= now();

  if v_future > 0 then
    return false;
  end if;

  update public.weekly_series
  set active = false,
      rolling = false
  where id = p_series_id
    and active = true;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic weekly booking: all slots or nothing (one transaction)
-- ---------------------------------------------------------------------------
create or replace function public.student_book_weekly_slots(
  p_slot_ids uuid[],
  p_duration_minutes integer,
  p_pay_later boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_slot_id uuid;
  v_booking_ids uuid[] := '{}';
  v_booking_id uuid;
  v_is_booked boolean;
  v_target_start timestamptz;
  v_occupy_mins integer;
  v_occupy_end timestamptz;
  v_held integer;
  v_student_name text;
  v_times text := '';
  v_i integer;
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

  if p_slot_ids is null or cardinality(p_slot_ids) = 0 then
    raise exception 'No weekly times to book';
  end if;

  perform public.lock_booking_calendar();

  v_occupy_mins := public.lesson_occupied_minutes(p_duration_minutes);
  v_series_id := gen_random_uuid();

  insert into public.weekly_series (id, student_id, duration_minutes, pay_later, rolling, active)
  values (v_series_id, auth.uid(), p_duration_minutes, p_pay_later, true, true);

  for v_i in 1..cardinality(p_slot_ids) loop
    v_slot_id := p_slot_ids[v_i];

    select id, is_booked, start_time
    into v_slot_id, v_is_booked, v_target_start
    from public.availability_slots
    where id = v_slot_id
    for update;

    if v_slot_id is null then
      raise exception 'That time is not available';
    end if;

    if v_is_booked then
      raise exception 'Sorry, another student just booked this slot.';
    end if;

    if v_target_start < now() then
      raise exception 'That time has already passed';
    end if;

    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
      raise exception 'Sorry, another student just booked this slot.';
    end if;

    update public.availability_slots
    set end_time = v_occupy_end,
        is_booked = true
    where id = v_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_slot_id
      and start_time >= v_target_start
      and start_time < v_occupy_end;

    v_held := public.hold_credits_for_lesson(auth.uid(), p_duration_minutes, p_pay_later);

    insert into public.bookings (
      student_id,
      slot_id,
      duration_minutes,
      pay_later,
      series_id,
      charged_cents
    )
    values (
      auth.uid(),
      v_slot_id,
      p_duration_minutes,
      p_pay_later,
      v_series_id,
      nullif(v_held, 0)
    )
    returning id into v_booking_id;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    if v_times = '' then
      v_times := public.format_lesson_when(v_target_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_target_start);
    end if;
  end loop;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  perform public.notify_admins(
    'New weekly series booked',
    coalesce(v_student_name, 'A student')
      || ' booked a weekly series ('
      || cardinality(v_booking_ids)::text
      || ' lessons, '
      || p_duration_minutes::text
      || ' min'
      || case when p_pay_later then ', pay later' else '' end
      || '): '
      || v_times
      || '.',
    'booking_weekly'
  );

  return v_booking_ids;
end;
$$;

grant execute on function public.student_book_weekly_slots(uuid[], integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel paths: stop series if nothing future left
-- ---------------------------------------------------------------------------
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
  v_series_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
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

  perform public.release_booking_credits(p_booking_id);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false,
      end_time = v_start + interval '60 minutes'
  where id = v_slot_id;

  perform public.restore_open_starts_in_range(v_start, v_occupy_end);
  perform public.deactivate_series_if_no_future(v_series_id);

  perform public.notify_user(
    v_student_id,
    'Class cancelled',
    'Your class on ' || public.format_lesson_when(v_start) || ' was cancelled by your tutor.',
    'class_cancelled'
  );
end;
$$;

grant execute on function public.cancel_booking(uuid) to authenticated;

create or replace function public.student_cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_series_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
  v_student_name text;
  v_stopped boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  if v_start < now() then
    raise exception 'Past classes cannot be cancelled';
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_occupy_end := v_start + make_interval(
    mins => public.lesson_occupied_minutes(v_duration)
  );

  perform public.release_booking_credits(p_booking_id);

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  update public.availability_slots
  set is_booked = false,
      end_time = v_start + interval '60 minutes'
  where id = v_slot_id;

  perform public.restore_open_starts_in_range(v_start, v_occupy_end);
  v_stopped := public.deactivate_series_if_no_future(v_series_id);

  perform public.notify_admins(
    'Class cancelled by student',
    coalesce(v_student_name, 'A student')
      || ' cancelled their class on '
      || public.format_lesson_when(v_start)
      || case when v_stopped then ' (weekly series stopped — no upcoming lessons left).' else '.' end,
    'student_cancelled'
  );
end;
$$;

grant execute on function public.student_cancel_my_booking(uuid) to authenticated;

-- Rolling maintainer: if no anchor left, deactivate instead of hanging
create or replace function public.maintain_one_rolling_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_anchor timestamptz;
  v_last timestamptz;
  v_future_count integer := 0;
  v_k integer;
  v_k_after_last integer;
  v_attempts integer := 0;
  v_max_lookahead integer := 12;
  v_target_count integer := 4;
  v_start timestamptz;
  v_booked integer := 0;
  v_skipped integer := 0;
  v_reason text;
  v_when text;
begin
  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found or not v_series.active or not v_series.rolling then
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'inactive'
    );
  end if;

  select min(s.start_time), max(s.start_time),
         count(*) filter (where s.start_time >= now())
  into v_anchor, v_last, v_future_count
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked';

  if v_anchor is null or v_future_count = 0 then
    perform public.deactivate_series_if_no_future(p_series_id);
    return jsonb_build_object(
      'series_id', p_series_id,
      'skipped', true,
      'reason', 'no_future_lessons',
      'deactivated', true
    );
  end if;

  if v_future_count >= v_target_count then
    return jsonb_build_object(
      'series_id', p_series_id,
      'booked', 0,
      'skipped_weeks', 0,
      'future_count', v_future_count
    );
  end if;

  v_k := 0;
  while public.add_weeks_tutor_wall(v_anchor, v_k) < now() loop
    v_k := v_k + 1;
    if v_k > 520 then
      exit;
    end if;
  end loop;

  v_k_after_last := 0;
  while public.add_weeks_tutor_wall(v_anchor, v_k_after_last) <= v_last loop
    v_k_after_last := v_k_after_last + 1;
    if v_k_after_last > 520 then
      exit;
    end if;
  end loop;

  v_k := greatest(v_k, v_k_after_last);

  while v_future_count < v_target_count and v_attempts < v_max_lookahead loop
    v_start := public.add_weeks_tutor_wall(v_anchor, v_k);
    v_k := v_k + 1;
    v_attempts := v_attempts + 1;

    if v_start < now() then
      continue;
    end if;

    if exists (
      select 1
      from public.bookings b
      join public.availability_slots s on s.id = b.slot_id
      where b.series_id = p_series_id
        and b.status = 'booked'
        and s.start_time = v_start
    ) then
      continue;
    end if;

    begin
      perform public.system_book_series_slot(p_series_id, v_start, false);
      v_booked := v_booked + 1;
      v_future_count := v_future_count + 1;
    exception
      when others then
        v_reason := sqlerrm;
        v_skipped := v_skipped + 1;
        v_when := public.format_lesson_when(v_start);
        perform public.notify_user(
          v_series.student_id,
          'Weekly class skipped',
          v_when
            || ' was unavailable ('
            || v_reason
            || '), so it was skipped. Your rolling weekly schedule will try the following week.',
          'weekly_skip'
        );
    end;
  end loop;

  return jsonb_build_object(
    'series_id', p_series_id,
    'booked', v_booked,
    'skipped_weeks', v_skipped,
    'future_count', v_future_count
  );
end;
$$;

revoke all on function public.maintain_one_rolling_series(uuid) from public, anon, authenticated;
revoke all on function public.deactivate_series_if_no_future(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Credit request → admin notification
-- ---------------------------------------------------------------------------
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
  v_student_name text;
  v_note text;
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

  v_note := coalesce(nullif(trim(p_note), ''), 'Zelle payment');

  insert into public.credit_requests (student_id, amount_cents, note)
  values (auth.uid(), p_amount_cents, v_note)
  returning id into v_request_id;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  perform public.notify_admins(
    'Credit request',
    coalesce(v_student_name, 'A student')
      || ' requested $'
      || to_char(p_amount_cents / 100.0, 'FM999999990.00')
      || case when v_note is not null and v_note <> '' then ' (' || v_note || ')' else '' end
      || '.',
    'credit_request'
  );

  return v_request_id;
end;
$$;

grant execute on function public.request_credits(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Delete all my notifications
-- ---------------------------------------------------------------------------
create or replace function public.delete_all_my_notifications()
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

  delete from public.notifications
  where user_id = auth.uid();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.delete_all_my_notifications() to authenticated;

notify pgrst, 'reload schema';
