-- Optional note when a student cancels (included in tutor notification).

drop function if exists public.student_cancel_my_booking(uuid);

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

  perform public.release_booking_credits(p_booking_id);

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
    || public.format_lesson_when(v_start)
    || case when v_stopped then ' (weekly series stopped — no upcoming lessons left).' else '.' end;

  if p_comment is not null and length(trim(p_comment)) > 0 then
    v_body := v_body || E'\n\nNote from student: ' || trim(p_comment);
  end if;

  perform public.notify_admins(
    'Class cancelled by student',
    v_body,
    'student_cancelled'
  );
end;
$$;

grant execute on function public.student_cancel_my_booking(uuid, text) to authenticated;

notify pgrst, 'reload schema';
