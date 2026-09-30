-- Weekly booking must start with the clicked week (never silently skip week 0).
-- Run after 52 in Supabase SQL Editor.

create or replace function public.student_book_lesson(p_slot_id uuid, p_duration_minutes integer DEFAULT 50, p_weekly boolean DEFAULT false, p_pay_later boolean DEFAULT false) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  v_held integer;
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
    v_target_start := public.add_weeks_tutor_wall(v_base_start, i);
    v_occupy_end := v_target_start + make_interval(mins => v_occupy_mins);

    select id, is_booked
    into v_slot_id, v_is_booked
    from public.availability_slots
    where start_time = v_target_start
    for update;

    if p_weekly then
      -- First week is the slot the student clicked — never skip it silently
      -- (skipping i=0 made weekly series appear to start "next week").
      if i = 0 then
        if v_slot_id is null then
          raise exception 'That time is not available';
        end if;

        if v_is_booked then
          if exists (
            select 1 from public.bookings
            where slot_id = v_slot_id and status = 'booked'
          ) then
            raise exception 'Sorry, another student just booked this slot.';
          end if;
          update public.availability_slots
          set is_booked = false
          where id = v_slot_id;
          v_is_booked := false;
        end if;

        if v_target_start < now() then
          raise exception 'That time has already passed';
        end if;

        if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
          raise exception 'Sorry, another student just booked this slot.';
        end if;
      else
        if v_slot_id is null or v_target_start < now() then
          continue;
        end if;

        if v_is_booked then
          if exists (
            select 1 from public.bookings
            where slot_id = v_slot_id and status = 'booked'
          ) then
            continue;
          end if;
          update public.availability_slots
          set is_booked = false
          where id = v_slot_id;
          v_is_booked := false;
        end if;

        if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
          continue;
        end if;
      end if;
    else
      if v_slot_id is null then
        raise exception 'That time is not available';
      end if;

      if v_is_booked then
        raise exception 'Sorry, another student just booked this slot.';
      end if;

      if v_target_start < now() then
        raise exception 'That time has already passed';
      end if;

      if public.booking_occupy_overlaps(v_target_start, v_occupy_end) then
        raise exception 'Sorry, another student just booked this slot.';
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

notify pgrst, 'reload schema';
