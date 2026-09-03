-- Stop / end a rolling weekly series (run after 24)
-- Modes:
--   'now'     → deactivate + cancel all future lessons in the series
--   'on_date' → deactivate + keep lessons through that calendar day (tutor TZ),
--               cancel anything after

create or replace function public.stop_my_weekly_series(
  p_series_id uuid,
  p_mode text,
  p_stop_on_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series public.weekly_series;
  v_student_name text;
  v_cutoff timestamptz;
  v_mode text;
  v_booking record;
  v_occupy_end timestamptz;
  v_cancelled integer := 0;
  v_kept integer := 0;
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

  if v_mode = 'on_date' and p_stop_on_date < (timezone('America/Los_Angeles', now()))::date then
    raise exception 'Stop date must be today or later';
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

  select full_name into v_student_name
  from public.profiles
  where id = v_series.student_id;

  if v_mode = 'now' then
    v_cutoff := now();
  else
    -- Keep anything that starts on p_stop_on_date in tutor TZ; cancel after that day.
    v_cutoff := ((p_stop_on_date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles');
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

    update public.bookings
    set status = 'cancelled'
    where id = v_booking.booking_id;

    update public.availability_slots
    set is_booked = false,
        end_time = v_booking.start_time + interval '60 minutes'
    where id = v_booking.slot_id;

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
        || '. Cancelled '
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
    'cancelled_count', v_cancelled,
    'kept_count', v_kept
  );
end;
$$;

grant execute on function public.stop_my_weekly_series(uuid, text, date) to authenticated;
