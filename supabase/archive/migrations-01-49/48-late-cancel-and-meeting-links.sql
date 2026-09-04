-- 12-hour no-refund student cancel + meeting links (series / per class).
-- Run after 47.

alter table public.profiles
  add column if not exists meeting_url text;

alter table public.weekly_series
  add column if not exists meeting_url text;

alter table public.bookings
  add column if not exists meeting_url text;

create or replace function public.is_late_student_cancel(p_start timestamptz)
returns boolean
language sql
stable
as $$
  select p_start < now() + interval '12 hours';
$$;

revoke all on function public.is_late_student_cancel(timestamptz) from public, anon, authenticated;

-- Copy weekly series link onto new bookings (no global default).
create or replace function public.fill_booking_meeting_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  if new.meeting_url is not null and length(trim(new.meeting_url)) > 0 then
    return new;
  end if;

  if new.series_id is not null then
    select nullif(trim(meeting_url), '')
    into v_url
    from public.weekly_series
    where id = new.series_id;
  end if;

  new.meeting_url := v_url;
  return new;
end;
$$;

drop trigger if exists bookings_fill_meeting_url on public.bookings;

create trigger bookings_fill_meeting_url
  before insert on public.bookings
  for each row
  execute function public.fill_booking_meeting_url();

revoke all on function public.fill_booking_meeting_url() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student cancel: no credit refund inside 12 hours
-- ---------------------------------------------------------------------------
create or replace function public.student_cancel_my_booking(
  p_booking_id uuid,
  p_comment text default null
)
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
  v_body text;
  v_late boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
  from public.bookings b
  left join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_student_id <> auth.uid() then
    raise exception 'Not your class';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be cancelled';
  end if;

  if v_start is null then
    raise exception 'Booking has no scheduled time';
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

  v_late := public.is_late_student_cancel(v_start);

  if not v_late then
    perform public.release_booking_credits(p_booking_id);
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id;

  if v_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_occupy_end
    where id = v_slot_id;

    perform public.restore_open_starts_in_range(v_start, v_occupy_end);
  end if;

  v_stopped := public.deactivate_series_if_no_future(v_series_id);

  v_body := coalesce(v_student_name, 'A student')
    || ' cancelled their class on '
    || public.format_lesson_when(v_start);

  if v_late then
    v_body := v_body || ' (late cancel — within 12 hours, credits not refunded)';
  end if;

  v_body := v_body
    || case when v_stopped then ' (weekly series stopped — no upcoming lessons left).' else '.' end;

  if p_comment is not null and length(trim(p_comment)) > 0 then
    v_body := v_body || E'\n\nNote from student: ' || trim(p_comment);
  end if;

  perform public.notify_admins(
    case when v_late then 'Late cancel by student' else 'Class cancelled by student' end,
    v_body,
    'student_cancelled'
  );
end;
$$;

grant execute on function public.student_cancel_my_booking(uuid, text) to authenticated;

-- Stop weekly: student late-cancel rule per lesson; admin always refunds.
create or replace function public.stop_my_weekly_series(
  p_series_id uuid,
  p_mode text,
  p_stop_on_date date default null,
  p_stop_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_student_name text;
  v_student_tz text;
  v_cutoff timestamptz;
  v_mode text;
  v_booking record;
  v_occupy_end timestamptz;
  v_cancelled integer := 0;
  v_kept integer := 0;
  v_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_mode := lower(trim(coalesce(p_mode, '')));
  if v_mode not in ('now', 'on_date') then
    raise exception 'Invalid stop mode';
  end if;

  if v_mode = 'on_date' and p_stop_on_date is null then
    raise exception 'Pick a stop date';
  end if;

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if v_series.student_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not your weekly series';
  end if;

  if not v_series.active then
    raise exception 'This weekly series is already stopped';
  end if;

  v_admin := public.is_admin();

  select full_name, display_timezone
  into v_student_name, v_student_tz
  from public.profiles
  where id = v_series.student_id;

  v_student_tz := coalesce(
    nullif(trim(p_stop_timezone), ''),
    nullif(trim(v_student_tz), ''),
    public.tutor_schedule_timezone()
  );

  if not exists (select 1 from pg_timezone_names where name = v_student_tz) then
    v_student_tz := public.tutor_schedule_timezone();
  end if;

  if v_mode = 'on_date' and p_stop_on_date < (timezone(v_student_tz, now()))::date then
    raise exception 'Stop date must be today or later';
  end if;

  if v_mode = 'now' then
    v_cutoff := now();
  else
    v_cutoff := ((p_stop_on_date + 1)::timestamp AT TIME ZONE v_student_tz);
  end if;

  perform public.lock_booking_calendar();

  for v_booking in
    select
      b.id as booking_id,
      b.slot_id,
      b.duration_minutes,
      s.start_time
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.series_id = p_series_id
      and b.status = 'booked'
      and s.start_time >= v_cutoff
    order by s.start_time
    for update of b
  loop
    v_occupy_end := v_booking.start_time + make_interval(
      mins => public.lesson_occupied_minutes(coalesce(v_booking.duration_minutes, 50))
    );

    if v_admin or not public.is_late_student_cancel(v_booking.start_time) then
      perform public.release_booking_credits(v_booking.booking_id);
    end if;

    update public.bookings
    set status = 'cancelled'
    where id = v_booking.booking_id;

    if v_booking.slot_id is not null then
      update public.availability_slots
      set is_booked = false,
          end_time = v_occupy_end
      where id = v_booking.slot_id;
    end if;

    perform public.restore_open_starts_in_range(v_booking.start_time, v_occupy_end);
    v_cancelled := v_cancelled + 1;
  end loop;

  select count(*)::integer into v_kept
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.series_id = p_series_id
    and b.status = 'booked'
    and s.start_time >= now();

  update public.weekly_series
  set active = false,
      rolling = false
  where id = p_series_id;

  if v_mode = 'now' then
    perform public.notify_admins(
      'Weekly series stopped',
      coalesce(v_student_name, 'A student')
        || ' stopped their weekly series now. Cancelled '
        || v_cancelled::text
        || ' upcoming class'
        || case when v_cancelled = 1 then '' else 'es' end
        || '.',
      'weekly_stopped'
    );
  else
    perform public.notify_admins(
      'Weekly series ending',
      coalesce(v_student_name, 'A student')
        || ' will end their weekly series after '
        || to_char(p_stop_on_date, 'Mon FMDD, YYYY')
        || ' ('
        || v_student_tz
        || '). Cancelled '
        || v_cancelled::text
        || ' class'
        || case when v_cancelled = 1 then '' else 'es' end
        || ' after that date'
        || case when v_kept > 0 then ' (' || v_kept::text || ' still scheduled through the stop date)' else '' end
        || '.',
      'weekly_stopped'
    );
  end if;

  return jsonb_build_object(
    'series_id', p_series_id,
    'mode', v_mode,
    'stop_on_date', p_stop_on_date,
    'stop_timezone', v_student_tz,
    'cancelled_count', v_cancelled,
    'kept_count', v_kept
  );
end;
$$;

grant execute on function public.stop_my_weekly_series(uuid, text, date, text) to authenticated;

-- Admin refunds a late cancel (student texted; you waive the 12h fee).
create or replace function public.admin_waive_late_cancel(
  p_booking_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_refunded integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select status into v_status
  from public.bookings
  where id = p_booking_id;

  if v_status is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'cancelled' then
    raise exception 'Only cancelled classes can be waived';
  end if;

  v_refunded := public.release_booking_credits(p_booking_id);
  return v_refunded;
end;
$$;

grant execute on function public.admin_waive_late_cancel(uuid) to authenticated;

create or replace function public.admin_set_booking_meeting_url(
  p_booking_id uuid,
  p_url text
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

  update public.bookings
  set meeting_url = nullif(trim(p_url), '')
  where id = p_booking_id;

  if not found then
    raise exception 'Booking not found';
  end if;
end;
$$;

grant execute on function public.admin_set_booking_meeting_url(uuid, text) to authenticated;

create or replace function public.admin_set_series_meeting_url(
  p_series_id uuid,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  v_url := nullif(trim(p_url), '');

  update public.weekly_series
  set meeting_url = v_url
  where id = p_series_id;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  update public.bookings
  set meeting_url = v_url
  where series_id = p_series_id
    and status = 'booked';
end;
$$;

grant execute on function public.admin_set_series_meeting_url(uuid, text) to authenticated;

-- No global default join link — set per class or per weekly series only.
drop function if exists public.admin_set_default_meeting_url(text);

notify pgrst, 'reload schema';
