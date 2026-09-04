-- Tutoring app schema baseline
-- Generated: 2026-09-04T03:45:40Z
-- Source: live Supabase (pg_dump --schema-only)
-- Do not re-run archive/migrations-01-49 on a DB that already has this schema.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_student_credits(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_student_credits(p_student_id uuid, p_amount_cents integer, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into public.payments (student_id, amount_cents, note, created_by)
  values (p_student_id, p_amount_cents, p_note, auth.uid());

  update public.profiles
  set credit_balance_cents = credit_balance_cents + p_amount_cents
  where id = p_student_id;

  perform public.append_credit_ledger(
    p_student_id,
    p_amount_cents,
    'payment',
    coalesce(nullif(trim(p_note), ''), 'Credits added')
  );
end;
$$;


--
-- Name: add_student_notification(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_student_notification(p_title text, p_body text, p_kind text DEFAULT 'weekly_skip'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  return public.notify_user(
    auth.uid(),
    p_title,
    p_body,
    coalesce(nullif(trim(p_kind), ''), 'weekly_skip')
  );
end;
$$;


--
-- Name: add_weeks_tutor_wall(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_weeks_tutor_wall(p_start timestamp with time zone, p_weeks integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_local timestamp;
  v_date date;
  v_time time;
begin
  if coalesce(p_weeks, 0) = 0 then
    return p_start;
  end if;

  v_local := p_start at time zone 'America/Los_Angeles';
  v_date := (v_local::date) + (p_weeks * 7);
  v_time := v_local::time;
  -- Interpret civil date+time in tutor TZ → timestamptz
  return (v_date + v_time) at time zone 'America/Los_Angeles';
end;
$$;


--
-- Name: admin_adjust_credits(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_credits(p_student_id uuid, p_amount_cents integer, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_note text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_amount_cents = 0 then
    raise exception 'Amount cannot be zero';
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student') then
    raise exception 'Student not found';
  end if;

  v_note := coalesce(nullif(trim(p_note), ''), 'Manual adjustment');

  if p_amount_cents > 0 then
    insert into public.payments (student_id, amount_cents, note, created_by)
    values (p_student_id, p_amount_cents, v_note, auth.uid());
  end if;

  update public.profiles
  set credit_balance_cents = credit_balance_cents + p_amount_cents
  where id = p_student_id;

  perform public.append_credit_ledger(
    p_student_id,
    p_amount_cents,
    'adjustment',
    v_note
  );
end;
$$;


--
-- Name: admin_book_slot(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_book_slot(p_student_id uuid, p_slot_id uuid, p_duration_minutes integer DEFAULT 50) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking_id uuid;
  v_start timestamptz;
  v_is_booked boolean;
  v_occupy_end timestamptz;
  v_duration integer;
  v_held integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if p_duration_minutes not in (25, 50, 80, 110) then
    raise exception 'Invalid lesson duration';
  end if;

  v_duration := p_duration_minutes;

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

  v_held := public.hold_credits_for_lesson(p_student_id, v_duration, false);

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    charged_cents
  )
  values (p_student_id, p_slot_id, v_duration, false, nullif(v_held, 0))
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;


--
-- Name: admin_reschedule_booking_to_time(uuid, date, integer, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reschedule_booking_to_time(p_booking_id uuid, p_date date, p_start_minutes integer, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_duration integer;
  v_old_charge integer;
  v_new_charge integer;
  v_rate integer;
  v_occupy integer;
  v_end timestamptz;
  v_m integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select
    slot_id,
    status,
    coalesce(duration_minutes, 50),
    student_id,
    charged_cents
  into v_slot_id, v_status, v_duration, v_student_id, v_old_charge
  from public.bookings
  where id = p_booking_id
  for update;

  if v_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if p_duration_minutes is not null and p_duration_minutes in (25, 50, 80, 110) then
    v_duration := p_duration_minutes;
  end if;

  v_occupy := public.lesson_occupied_minutes(v_duration);
  v_end := p_start_time + make_interval(mins => v_occupy);

  if exists (
    select 1
    from public.availability_blockouts
    where blockout_date = p_date and start_minutes is null
  ) then
    raise exception 'That day is fully blocked';
  end if;

  for v_m in
    select generate_series(p_start_minutes, p_start_minutes + v_occupy - 15, 15)
  loop
    if exists (
      select 1
      from public.availability_blockouts
      where blockout_date = p_date and start_minutes = v_m
    ) then
      raise exception 'That time is blocked';
    end if;
  end loop;

  if public.booking_occupy_overlaps(p_start_time, v_end, p_booking_id) then
    raise exception 'Another class is already scheduled at this time';
  end if;

  update public.availability_slots
  set start_time = p_start_time,
      end_time = v_end
  where id = v_slot_id;

  select class_rate_cents into v_rate
  from public.profiles
  where id = v_student_id
  for update;

  v_new_charge := public.lesson_charge_cents(v_rate, v_duration);

  if coalesce(v_old_charge, 0) <> v_new_charge then
    update public.profiles
    set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
    where id = v_student_id;

    perform public.append_credit_ledger(
      v_student_id,
      coalesce(v_old_charge, 0) - v_new_charge,
      'duration_adjust',
      'Lesson length updated',
      p_booking_id
    );
  end if;

  update public.bookings
  set duration_minutes = v_duration,
      charged_cents = v_new_charge
  where id = p_booking_id;
end;
$$;


--
-- Name: admin_set_booking_meeting_url(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_booking_meeting_url(p_booking_id uuid, p_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_set_series_meeting_url(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_series_meeting_url(p_series_id uuid, p_url text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: admin_waive_late_cancel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_waive_late_cancel(p_booking_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: append_credit_ledger(uuid, integer, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.append_credit_ledger(p_student_id uuid, p_amount_cents integer, p_kind text, p_description text, p_booking_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_amount_cents = 0 then
    return;
  end if;

  insert into public.credit_ledger (
    student_id,
    amount_cents,
    kind,
    description,
    booking_id
  )
  values (
    p_student_id,
    p_amount_cents,
    p_kind,
    p_description,
    p_booking_id
  );
end;
$$;


--
-- Name: approve_credit_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_credit_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_id uuid;
  v_amount integer;
  v_note text;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, amount_cents, note, status
  into v_student_id, v_amount, v_note, v_status
  from public.credit_requests
  where id = p_request_id
  for update;

  if v_student_id is null then
    raise exception 'Credit request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Request is not pending';
  end if;

  insert into public.payments (student_id, amount_cents, note, created_by)
  values (v_student_id, v_amount, v_note, auth.uid());

  update public.profiles
  set credit_balance_cents = credit_balance_cents + v_amount
  where id = v_student_id;

  perform public.append_credit_ledger(
    v_student_id,
    v_amount,
    'payment',
    coalesce(nullif(trim(v_note), ''), 'Credits added')
  );

  update public.credit_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;


--
-- Name: booking_occupy_overlaps(timestamp with time zone, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.booking_occupy_overlaps(p_start timestamp with time zone, p_occupy_end timestamp with time zone, p_exclude_booking_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
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


--
-- Name: cancel_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking(p_booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: cancel_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking(p_booking_id uuid, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  perform public.lock_booking_calendar();
  perform public.cancel_booking_core(p_booking_id, p_comment, true);
end;
$$;


--
-- Name: cancel_booking_before_slot_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking_before_slot_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking_id uuid;
begin
  for v_booking_id in
    select id
    from public.bookings
    where slot_id = old.id
      and status = 'booked'
    for update
  loop
    perform public.lock_booking_calendar();
    perform public.cancel_booking_core(v_booking_id, null, true);
  end loop;

  return old;
end;
$$;


--
-- Name: cancel_booking_core(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_booking_core(p_booking_id uuid, p_comment text DEFAULT NULL::text, p_notify boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_series_id uuid;
  v_start timestamptz;
  v_duration integer;
  v_occupy_end timestamptz;
  v_body text;
begin
  select b.slot_id, b.status, b.student_id, b.series_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_slot_id, v_status, v_student_id, v_series_id, v_start, v_duration
  from public.bookings b
  left join public.availability_slots s on s.id = b.slot_id
  where b.id = p_booking_id
  for update of b;

  if not found then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    return;
  end if;

  if v_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

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

  perform public.deactivate_series_if_no_future(v_series_id);

  if p_notify then
    v_body := 'Your class on '
      || public.format_lesson_when(v_start)
      || ' was cancelled by your tutor.';

    if p_comment is not null and length(trim(p_comment)) > 0 then
      v_body := v_body || E'\n\nNote from your tutor: ' || trim(p_comment);
    end if;

    perform public.notify_user(
      v_student_id,
      'Class cancelled',
      v_body,
      'class_cancelled'
    );
  end if;
end;
$$;


--
-- Name: complete_booking(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_booking(p_booking_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_id uuid;
  v_status text;
  v_rate integer;
  v_duration integer;
  v_pay_later boolean;
  v_charge integer;
  v_already_held integer;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select student_id, status, duration_minutes, pay_later, charged_cents
  into v_student_id, v_status, v_duration, v_pay_later, v_already_held
  from public.bookings
  where id = p_booking_id
  for update;

  if v_student_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Booking is not active';
  end if;

  select class_rate_cents into v_rate
  from public.profiles
  where id = v_student_id;

  v_charge := public.lesson_charge_cents(v_rate, coalesce(v_duration, 50));

  -- Credits were already held at book time for non-pay-later lessons.
  if v_already_held is not null and v_already_held > 0 then
    update public.bookings
    set status = 'completed',
        charged_cents = v_already_held,
        completed_at = now()
    where id = p_booking_id;
    return;
  end if;

  update public.bookings
  set status = 'completed',
      charged_cents = v_charge,
      completed_at = now()
  where id = p_booking_id;

  if not v_pay_later then
    update public.profiles
    set credit_balance_cents = credit_balance_cents - v_charge
    where id = v_student_id;
  end if;
end;
$$;


--
-- Name: deactivate_series_if_no_future(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_series_if_no_future(p_series_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_all_my_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_all_my_notifications() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_my_notification(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_my_notification(p_notification_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  delete from public.notifications
  where id = p_notification_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Notification not found';
  end if;
end;
$$;


--
-- Name: enforce_booking_fits_tutor_schedule(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_booking_fits_tutor_schedule() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_start timestamptz;
  v_duration integer;
begin
  if public.is_admin() then
    return new;
  end if;

  if new.slot_id is null then
    return new;
  end if;

  v_duration := coalesce(new.duration_minutes, 50);

  select s.start_time
  into v_start
  from public.availability_slots s
  where s.id = new.slot_id;

  if v_start is null then
    raise exception 'That time is not available';
  end if;

  if not public.tutor_start_fits_duration(v_start, v_duration) then
    raise exception 'That time is not available';
  end if;

  return new;
end;
$$;


--
-- Name: ensure_my_calendar_feed_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_my_calendar_feed_token() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.calendar_feed_tokens (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select token into v_token
  from public.calendar_feed_tokens
  where user_id = auth.uid();

  return v_token;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: availability_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    is_booked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_slot_times CHECK ((end_time > start_time))
);


--
-- Name: ensure_open_slot(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_open_slot(p_start_time timestamp with time zone, p_end_time timestamp with time zone) RETURNS public.availability_slots
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot public.availability_slots;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_end_time <= p_start_time then
    raise exception 'Invalid slot times';
  end if;

  if p_start_time < now() - interval '1 minute' then
    raise exception 'That time has already passed';
  end if;

  if not public.tutor_window_is_open(p_start_time, p_end_time) then
    raise exception 'That time is not available';
  end if;

  select *
  into v_slot
  from public.availability_slots
  where start_time = p_start_time
  for update;

  if found then
    if v_slot.is_booked then
      raise exception 'Slot is already booked';
    end if;
    if v_slot.end_time < p_end_time then
      update public.availability_slots
      set end_time = p_end_time
      where id = v_slot.id
      returning * into v_slot;
    end if;
    return v_slot;
  end if;

  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and s.start_time = p_start_time
  ) then
    raise exception 'Slot is already booked';
  end if;

  begin
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_start_time, p_end_time, false)
    returning * into v_slot;
  exception
    when unique_violation then
      select *
      into v_slot
      from public.availability_slots
      where start_time = p_start_time
      for update;

      if not found or v_slot.is_booked then
        raise exception 'Slot is already booked';
      end if;
  end;

  return v_slot;
end;
$$;


--
-- Name: ensure_weekly_series(uuid, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_weekly_series(p_series_id uuid, p_duration_minutes integer, p_pay_later boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fill_booking_meeting_url(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fill_booking_meeting_url() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: format_lesson_when(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.format_lesson_when(p_start timestamp with time zone) RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  select trim(
    to_char(
      p_start at time zone public.tutor_schedule_timezone(),
      'Dy Mon FMDD, FMHH12:MI AM'
    )
  )
  || ' '
  || replace(split_part(public.tutor_schedule_timezone(), '/', 2), '_', ' ');
$$;


--
-- Name: get_calendar_feed_events(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_calendar_feed_events(p_token uuid) RETURNS TABLE(booking_id uuid, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_is_admin boolean;
begin
  select t.user_id, p.role = 'admin'
  into v_user_id, v_is_admin
  from public.calendar_feed_tokens t
  join public.profiles p on p.id = t.user_id
  where t.token = p_token;

  if v_user_id is null then
    return;
  end if;

  return query
  select
    b.id as booking_id,
    case
      when v_is_admin then coalesce(sp.full_name, 'Student') || ' — ' || coalesce(b.duration_minutes, 50)::text || ' min'
      else 'Tutoring lesson'
    end as title,
    case
      when b.pay_later then 'Pay later'
      else 'Credits on file'
    end as description,
    s.start_time as start_at,
    s.start_time + make_interval(mins => coalesce(b.duration_minutes, 50)) as end_at,
    b.status
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  left join public.profiles sp on sp.id = b.student_id
  where b.status = 'booked'
    and s.start_time >= now() - interval '6 hours'
    and (
      (v_is_admin and b.student_id is not null)
      or (not v_is_admin and b.student_id = v_user_id)
    )
  order by s.start_time asc;
end;
$$;


--
-- Name: get_my_credit_history(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_credit_history(p_limit integer DEFAULT 30) RETURNS TABLE(id uuid, amount_cents integer, kind text, description text, booking_id uuid, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    cl.id,
    cl.amount_cents,
    cl.kind,
    cl.description,
    cl.booking_id,
    cl.created_at
  from public.credit_ledger cl
  where cl.student_id = auth.uid()
  order by cl.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;


--
-- Name: get_student_credit_history(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_student_credit_history(p_student_id uuid, p_limit integer DEFAULT 30) RETURNS TABLE(id uuid, amount_cents integer, kind text, description text, booking_id uuid, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    cl.id,
    cl.amount_cents,
    cl.kind,
    cl.description,
    cl.booking_id,
    cl.created_at
  from public.credit_ledger cl
  where cl.student_id = p_student_id
    and public.is_admin()
  order by cl.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: hold_credits_for_lesson(uuid, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hold_credits_for_lesson(p_student_id uuid, p_duration_minutes integer, p_pay_later boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rate integer;
  v_charge integer;
  v_description text;
begin
  select class_rate_cents into v_rate
  from public.profiles
  where id = p_student_id
  for update;

  if v_rate is null then
    raise exception 'Student not found';
  end if;

  v_charge := public.lesson_charge_cents(v_rate, p_duration_minutes);

  update public.profiles
  set credit_balance_cents = credit_balance_cents - v_charge
  where id = p_student_id;

  v_description := case
    when p_pay_later then 'Reserved for lesson (pay before class)'
    else 'Reserved for a lesson'
  end;

  perform public.append_credit_ledger(
    p_student_id,
    -v_charge,
    'book_hold',
    v_description
  );

  return v_charge;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;


--
-- Name: is_late_student_cancel(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_late_student_cancel(p_start timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select p_start < now() + interval '12 hours';
$$;


--
-- Name: lesson_charge_cents(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lesson_charge_cents(p_class_rate_cents integer, p_duration_minutes integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_duration_minutes
    when 25 then round(p_class_rate_cents * 0.5)::integer
    when 50 then p_class_rate_cents
    when 80 then round(p_class_rate_cents * 1.5)::integer
    when 110 then (p_class_rate_cents * 2)
    else p_class_rate_cents
  end;
$$;


--
-- Name: lesson_occupied_minutes(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lesson_occupied_minutes(p_duration_minutes integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select ceil((p_duration_minutes + 5)::numeric / 15)::integer * 15;
$$;


--
-- Name: list_occupied_booking_ranges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_occupied_booking_ranges() RETURNS TABLE(start_time timestamp with time zone, end_time timestamp with time zone, duration_minutes integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    s.start_time,
    s.end_time,
    coalesce(b.duration_minutes, 50) as duration_minutes
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.status = 'booked';
$$;


--
-- Name: lock_booking_calendar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_booking_calendar() RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  -- Single-tutor calendar: serialize book/cancel so overlap checks can't race
  perform pg_advisory_xact_lock(87201442);
end;
$$;


--
-- Name: maintain_all_rolling_weekly(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.maintain_all_rolling_weekly() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_series_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_count integer := 0;
begin
  for v_series_id in
    select id
    from public.weekly_series
    where active = true
      and rolling = true
  loop
    v_one := public.maintain_one_rolling_series(v_series_id);
    v_results := v_results || jsonb_build_array(v_one);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'series_count', v_count,
    'ran_at', now(),
    'results', v_results
  );
end;
$$;


--
-- Name: maintain_my_rolling_weekly(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.maintain_my_rolling_weekly() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_series_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  for v_series_id in
    select id
    from public.weekly_series
    where active = true
      and rolling = true
      and student_id = auth.uid()
  loop
    v_one := public.maintain_one_rolling_series(v_series_id);
    v_results := v_results || jsonb_build_array(v_one);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'series_count', v_count,
    'ran_at', now(),
    'results', v_results
  );
end;
$$;


--
-- Name: maintain_one_rolling_series(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.maintain_one_rolling_series(p_series_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: mark_my_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_my_notifications_read() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: mark_slot_booked(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_slot_booked() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: notify_admins(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_admins(p_title text, p_body text, p_kind text DEFAULT 'booking'::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer := 0;
  v_admin_id uuid;
begin
  for v_admin_id in
    select id from public.profiles where role = 'admin'
  loop
    perform public.notify_user(v_admin_id, p_title, p_body, p_kind);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


--
-- Name: notify_user(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_user(p_user_id uuid, p_title text, p_body text, p_kind text DEFAULT 'general'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  insert into public.notifications (user_id, title, body, kind)
  values (
    p_user_id,
    p_title,
    p_body,
    coalesce(nullif(trim(p_kind), ''), 'general')
  )
  returning id into v_id;

  perform public.trim_user_notifications(p_user_id, 20);

  return v_id;
end;
$$;


--
-- Name: prevent_unauthorized_admin_promotion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_unauthorized_admin_promotion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: reject_credit_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_credit_request(p_request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select status into v_status
  from public.credit_requests
  where id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Credit request not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Request is not pending';
  end if;

  update public.credit_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_request_id;
end;
$$;


--
-- Name: release_booking_credits(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_booking_credits(p_booking_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_id uuid;
  v_status text;
  v_charged integer;
  v_duration integer;
  v_rate integer;
  v_booking_created timestamptz;
begin
  select
    b.student_id,
    b.status,
    b.charged_cents,
    coalesce(b.duration_minutes, 50),
    b.created_at
  into v_student_id, v_status, v_charged, v_duration, v_booking_created
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if v_student_id is null then
    return 0;
  end if;

  if exists (
    select 1
    from public.credit_ledger cl
    where cl.booking_id = p_booking_id
      and cl.kind = 'cancel_refund'
  ) then
    return 0;
  end if;

  if v_charged is null or v_charged <= 0 then
    if v_status <> 'booked' then
      return 0;
    end if;

    select class_rate_cents into v_rate
    from public.profiles
    where id = v_student_id;

    v_charged := public.lesson_charge_cents(v_rate, v_duration);

    -- Only infer a hold when the ledger shows one near booking time.
    if not exists (
      select 1
      from public.credit_ledger cl
      where cl.student_id = v_student_id
        and cl.kind = 'book_hold'
        and cl.amount_cents = -v_charged
        and cl.created_at between v_booking_created - interval '2 minutes'
                            and v_booking_created + interval '2 minutes'
    ) then
      return 0;
    end if;
  end if;

  update public.profiles
  set credit_balance_cents = credit_balance_cents + v_charged
  where id = v_student_id;

  update public.bookings
  set charged_cents = null
  where id = p_booking_id;

  perform public.append_credit_ledger(
    v_student_id,
    v_charged,
    'cancel_refund',
    'Refunded for cancelled lesson',
    p_booking_id
  );

  return v_charged;
end;
$$;


--
-- Name: request_credits(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_credits(p_amount_cents integer, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: reschedule_booking(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reschedule_booking(p_booking_id uuid, p_new_slot_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old_slot_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  select slot_id, status into v_old_slot_id, v_status
  from public.bookings
  where id = p_booking_id;

  if v_old_slot_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if p_new_slot_id = v_old_slot_id then
    return;
  end if;

  update public.availability_slots
  set is_booked = true
  where id = p_new_slot_id and is_booked = false;

  if not found then
    raise exception 'New slot is not available';
  end if;

  update public.availability_slots
  set is_booked = false
  where id = v_old_slot_id;

  update public.bookings
  set slot_id = p_new_slot_id
  where id = p_booking_id;
end;
$$;


--
-- Name: restore_open_starts_in_range(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_open_starts_in_range(p_start timestamp with time zone, p_occupy_end timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: rotate_my_calendar_feed_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotate_my_calendar_feed_token() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.calendar_feed_tokens
  set token = gen_random_uuid(),
      updated_at = now()
  where user_id = auth.uid()
  returning token into v_token;

  if v_token is null then
    return public.ensure_my_calendar_feed_token();
  end if;

  return v_token;
end;
$$;


--
-- Name: stop_my_weekly_series(uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_my_weekly_series(p_series_id uuid, p_mode text, p_stop_on_date date DEFAULT NULL::date, p_stop_timezone text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: student_book_lesson(uuid, integer, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_book_lesson(p_slot_id uuid, p_duration_minutes integer DEFAULT 50, p_weekly boolean DEFAULT false, p_pay_later boolean DEFAULT false) RETURNS uuid[]
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


--
-- Name: student_book_series_slot(uuid, integer, boolean, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_book_series_slot(p_slot_id uuid, p_duration_minutes integer, p_pay_later boolean, p_series_id uuid, p_notify boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_series public.weekly_series;
  v_slot_id uuid;
  v_is_booked boolean;
  v_target_start timestamptz;
  v_occupy_end timestamptz;
  v_occupy_mins integer;
  v_booking_id uuid;
  v_student_name text;
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
    p_series_id,
    nullif(v_held, 0)
  )
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


--
-- Name: student_book_slot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_book_slot(p_slot_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ids uuid[];
begin
  v_ids := public.student_book_lesson(p_slot_id, 50, false, false);
  return v_ids[1];
end;
$$;


--
-- Name: student_book_weekly_slots(uuid[], integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_book_weekly_slots(p_slot_ids uuid[], p_duration_minutes integer, p_pay_later boolean DEFAULT false) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: student_cancel_my_booking(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_cancel_my_booking(p_booking_id uuid, p_comment text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: student_notify_booking_summary(boolean, integer, boolean, timestamp with time zone[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_notify_booking_summary(p_weekly boolean, p_duration_minutes integer, p_pay_later boolean, p_start_times timestamp with time zone[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_student_name text;
  v_times text := '';
  v_start timestamptz;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can send booking notifications';
  end if;

  v_count := coalesce(cardinality(p_start_times), 0);
  if v_count = 0 then
    return;
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = auth.uid();

  foreach v_start in array p_start_times loop
    if v_times = '' then
      v_times := public.format_lesson_when(v_start);
    else
      v_times := v_times || '; ' || public.format_lesson_when(v_start);
    end if;
  end loop;

  if p_weekly then
    perform public.notify_admins(
      'New weekly series booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly series ('
        || v_count::text
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
end;
$$;


--
-- Name: student_reschedule_my_booking(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_reschedule_my_booking(p_booking_id uuid, p_new_start timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_old_start timestamptz;
  v_duration integer;
  v_occupy_mins integer;
  v_old_occupy_end timestamptz;
  v_new_occupy_end timestamptz;
  v_new_slot_id uuid;
  v_new_is_booked boolean;
  v_student_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select b.slot_id, b.status, b.student_id, s.start_time, coalesce(b.duration_minutes, 50)
  into v_old_slot_id, v_status, v_student_id, v_old_start, v_duration
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
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if v_old_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

  if v_old_start < now() then
    raise exception 'Past classes cannot be rescheduled';
  end if;

  if p_new_start < now() then
    raise exception 'That time has already passed';
  end if;

  if p_new_start = v_old_start then
    return;
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_occupy_mins := public.lesson_occupied_minutes(v_duration);
  v_old_occupy_end := v_old_start + make_interval(mins => v_occupy_mins);
  v_new_occupy_end := p_new_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_new_start, v_new_occupy_end, p_booking_id) then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

  select id, is_booked
  into v_new_slot_id, v_new_is_booked
  from public.availability_slots
  where start_time = p_new_start
  for update;

  if v_new_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_new_start, v_new_occupy_end, false)
    returning id into v_new_slot_id;
    v_new_is_booked := false;
  elsif v_new_is_booked then
    raise exception 'Sorry, another student just booked this slot.';
  elsif v_new_slot_id = v_old_slot_id then
    update public.availability_slots
    set start_time = p_new_start,
        end_time = v_new_occupy_end,
        is_booked = true
    where id = v_old_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_old_slot_id
      and start_time >= p_new_start
      and start_time < v_new_occupy_end;

    perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

    perform public.notify_admins(
      'Class rescheduled by student',
      coalesce(v_student_name, 'A student')
        || ' moved their class from '
        || public.format_lesson_when(v_old_start)
        || ' to '
        || public.format_lesson_when(p_new_start)
        || '.',
      'student_rescheduled'
    );
    return;
  end if;

  update public.availability_slots
  set end_time = v_new_occupy_end,
      is_booked = true
  where id = v_new_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_new_slot_id
    and start_time >= p_new_start
    and start_time < v_new_occupy_end;

  update public.bookings
  set slot_id = v_new_slot_id
  where id = p_booking_id;

  if v_old_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_old_occupy_end
    where id = v_old_slot_id;
  end if;

  perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

  perform public.notify_admins(
    'Class rescheduled by student',
    coalesce(v_student_name, 'A student')
      || ' moved their class from '
      || public.format_lesson_when(v_old_start)
      || ' to '
      || public.format_lesson_when(p_new_start)
      || '.',
    'student_rescheduled'
  );
end;
$$;


--
-- Name: student_reschedule_my_booking(uuid, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.student_reschedule_my_booking(p_booking_id uuid, p_new_start timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_old_slot_id uuid;
  v_status text;
  v_student_id uuid;
  v_old_start timestamptz;
  v_old_duration integer;
  v_duration integer;
  v_old_charge integer;
  v_rate integer;
  v_new_charge integer;
  v_occupy_mins integer;
  v_old_occupy_mins integer;
  v_old_occupy_end timestamptz;
  v_new_occupy_end timestamptz;
  v_new_slot_id uuid;
  v_new_is_booked boolean;
  v_student_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform public.lock_booking_calendar();

  select
    b.slot_id,
    b.status,
    b.student_id,
    s.start_time,
    coalesce(b.duration_minutes, 50),
    b.charged_cents
  into
    v_old_slot_id,
    v_status,
    v_student_id,
    v_old_start,
    v_old_duration,
    v_old_charge
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
    raise exception 'Only active bookings can be rescheduled';
  end if;

  if v_old_start is null then
    raise exception 'Booking has no scheduled time';
  end if;

  if v_old_start < now() then
    raise exception 'Past classes cannot be rescheduled';
  end if;

  if p_new_start < now() then
    raise exception 'That time has already passed';
  end if;

  v_duration := v_old_duration;
  if p_duration_minutes is not null then
    if p_duration_minutes not in (25, 50, 80, 110) then
      raise exception 'Invalid lesson duration';
    end if;
    v_duration := p_duration_minutes;
  end if;

  if p_new_start = v_old_start and v_duration = v_old_duration then
    return;
  end if;

  select full_name into v_student_name
  from public.profiles
  where id = v_student_id;

  v_old_occupy_mins := public.lesson_occupied_minutes(v_old_duration);
  v_occupy_mins := public.lesson_occupied_minutes(v_duration);
  v_old_occupy_end := v_old_start + make_interval(mins => v_old_occupy_mins);
  v_new_occupy_end := p_new_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_new_start, v_new_occupy_end, p_booking_id) then
    raise exception 'Sorry, another student just booked this slot.';
  end if;

  if p_new_start = v_old_start then
    if v_old_slot_id is not null then
      update public.availability_slots
      set end_time = v_new_occupy_end,
          is_booked = true
      where id = v_old_slot_id;

      delete from public.availability_slots
      where is_booked = false
        and id <> v_old_slot_id
        and start_time >= p_new_start
        and start_time < v_new_occupy_end;

      if v_new_occupy_end < v_old_occupy_end then
        perform public.restore_open_starts_in_range(v_new_occupy_end, v_old_occupy_end);
      end if;
    end if;

    select class_rate_cents into v_rate
    from public.profiles
    where id = v_student_id
    for update;

    v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
    if coalesce(v_old_charge, 0) <> v_new_charge then
      update public.profiles
      set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
      where id = v_student_id;

      perform public.append_credit_ledger(
        v_student_id,
        coalesce(v_old_charge, 0) - v_new_charge,
        'duration_adjust',
        'Lesson length updated',
        p_booking_id
      );
    end if;

    update public.bookings
    set duration_minutes = v_duration,
        charged_cents = v_new_charge
    where id = p_booking_id;

    perform public.notify_admins(
      'Class rescheduled by student',
      coalesce(v_student_name, 'A student')
        || ' updated their class on '
        || public.format_lesson_when(v_old_start)
        || ' to '
        || v_duration::text
        || ' minutes.',
      'student_rescheduled'
    );
    return;
  end if;

  select id, is_booked
  into v_new_slot_id, v_new_is_booked
  from public.availability_slots
  where start_time = p_new_start
  for update;

  if v_new_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_new_start, v_new_occupy_end, false)
    returning id into v_new_slot_id;
    v_new_is_booked := false;
  elsif v_new_is_booked and v_new_slot_id <> v_old_slot_id then
    raise exception 'Sorry, another student just booked this slot.';
  elsif v_new_slot_id = v_old_slot_id then
    update public.availability_slots
    set start_time = p_new_start,
        end_time = v_new_occupy_end,
        is_booked = true
    where id = v_old_slot_id;

    delete from public.availability_slots
    where is_booked = false
      and id <> v_old_slot_id
      and start_time >= p_new_start
      and start_time < v_new_occupy_end;

    perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

    select class_rate_cents into v_rate
    from public.profiles
    where id = v_student_id
    for update;

    v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
    if coalesce(v_old_charge, 0) <> v_new_charge then
      update public.profiles
      set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
      where id = v_student_id;

      perform public.append_credit_ledger(
        v_student_id,
        coalesce(v_old_charge, 0) - v_new_charge,
        'duration_adjust',
        'Lesson length updated',
        p_booking_id
      );
    end if;

    update public.bookings
    set duration_minutes = v_duration,
        charged_cents = v_new_charge
    where id = p_booking_id;

    perform public.notify_admins(
      'Class rescheduled by student',
      coalesce(v_student_name, 'A student')
        || ' moved their class from '
        || public.format_lesson_when(v_old_start)
        || ' to '
        || public.format_lesson_when(p_new_start)
        || '.',
      'student_rescheduled'
    );
    return;
  end if;

  update public.availability_slots
  set end_time = v_new_occupy_end,
      is_booked = true
  where id = v_new_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_new_slot_id
    and start_time >= p_new_start
    and start_time < v_new_occupy_end;

  update public.bookings
  set slot_id = v_new_slot_id,
      duration_minutes = v_duration
  where id = p_booking_id;

  select class_rate_cents into v_rate
  from public.profiles
  where id = v_student_id
  for update;

  v_new_charge := public.lesson_charge_cents(v_rate, v_duration);
  if coalesce(v_old_charge, 0) <> v_new_charge then
    update public.profiles
    set credit_balance_cents = credit_balance_cents + coalesce(v_old_charge, 0) - v_new_charge
    where id = v_student_id;

    perform public.append_credit_ledger(
      v_student_id,
      coalesce(v_old_charge, 0) - v_new_charge,
      'duration_adjust',
      'Lesson length updated',
      p_booking_id
    );
  end if;

  update public.bookings
  set charged_cents = v_new_charge
  where id = p_booking_id;

  if v_old_slot_id is not null then
    update public.availability_slots
    set is_booked = false,
        end_time = v_old_occupy_end
    where id = v_old_slot_id;
  end if;

  perform public.restore_open_starts_in_range(v_old_start, v_old_occupy_end);

  perform public.notify_admins(
    'Class rescheduled by student',
    coalesce(v_student_name, 'A student')
      || ' moved their class from '
      || public.format_lesson_when(v_old_start)
      || ' to '
      || public.format_lesson_when(p_new_start)
      || '.',
    'student_rescheduled'
  );
end;
$$;


--
-- Name: system_book_series_slot(uuid, timestamp with time zone, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.system_book_series_slot(p_series_id uuid, p_start timestamp with time zone, p_notify boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_series public.weekly_series;
  v_slot_id uuid;
  v_is_booked boolean;
  v_occupy_mins integer;
  v_occupy_end timestamptz;
  v_booking_id uuid;
  v_student_name text;
  v_held integer;
begin
  perform public.lock_booking_calendar();

  select * into v_series
  from public.weekly_series
  where id = p_series_id
  for update;

  if not found then
    raise exception 'Weekly series not found';
  end if;

  if not v_series.active or not v_series.rolling then
    raise exception 'This weekly series is no longer active';
  end if;

  if p_start < now() then
    raise exception 'That time has already passed';
  end if;

  if not public.tutor_start_fits_duration(p_start, v_series.duration_minutes) then
    raise exception 'That time is not available';
  end if;

  v_occupy_mins := public.lesson_occupied_minutes(v_series.duration_minutes);
  v_occupy_end := p_start + make_interval(mins => v_occupy_mins);

  if public.booking_occupy_overlaps(p_start, v_occupy_end) then
    raise exception 'Another lesson is already scheduled during that time';
  end if;

  select id, is_booked
  into v_slot_id, v_is_booked
  from public.availability_slots
  where start_time = p_start
  for update;

  if v_slot_id is null then
    insert into public.availability_slots (start_time, end_time, is_booked)
    values (p_start, v_occupy_end, false)
    returning id into v_slot_id;
    v_is_booked := false;
  elsif v_is_booked then
    raise exception 'Slot is already booked';
  end if;

  update public.availability_slots
  set end_time = v_occupy_end,
      is_booked = true
  where id = v_slot_id;

  delete from public.availability_slots
  where is_booked = false
    and id <> v_slot_id
    and start_time >= p_start
    and start_time < v_occupy_end;

  v_held := public.hold_credits_for_lesson(
    v_series.student_id,
    v_series.duration_minutes,
    v_series.pay_later
  );

  insert into public.bookings (
    student_id,
    slot_id,
    duration_minutes,
    pay_later,
    series_id,
    charged_cents
  )
  values (
    v_series.student_id,
    v_slot_id,
    v_series.duration_minutes,
    v_series.pay_later,
    p_series_id,
    nullif(v_held, 0)
  )
  returning id into v_booking_id;

  if p_notify then
    select full_name into v_student_name
    from public.profiles
    where id = v_series.student_id;

    perform public.notify_admins(
      'New weekly class booked',
      coalesce(v_student_name, 'A student')
        || ' booked a weekly class for '
        || public.format_lesson_when(p_start)
        || ' ('
        || v_series.duration_minutes::text
        || ' min'
        || case when v_series.pay_later then ', pay later' else '' end
        || ').',
      'booking_weekly'
    );
  end if;

  return v_booking_id;
end;
$$;


--
-- Name: trim_user_notifications(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trim_user_notifications(p_user_id uuid, p_keep integer DEFAULT 20) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.notifications n
  where n.user_id = p_user_id
    and n.id not in (
      select id
      from public.notifications
      where user_id = p_user_id
      order by created_at desc
      limit greatest(p_keep, 1)
    );
end;
$$;


--
-- Name: tutor_civil_from_start(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_civil_from_start(p_start timestamp with time zone) RETURNS TABLE(tutor_date date, start_minutes integer, dow integer)
    LANGUAGE sql STABLE
    AS $$
  select
    (p_start at time zone 'America/Los_Angeles')::date as tutor_date,
    (
      extract(hour from (p_start at time zone 'America/Los_Angeles'))::integer * 60
      + extract(minute from (p_start at time zone 'America/Los_Angeles'))::integer
    ) as start_minutes,
    extract(dow from (p_start at time zone 'America/Los_Angeles')::date)::integer as dow;
$$;


--
-- Name: tutor_minute_is_open(date, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_minute_is_open(p_date date, p_start_minutes integer, p_dow integer) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_whole_day boolean;
  v_is_extra boolean;
  v_is_weekly boolean;
  v_is_blocked boolean;
begin
  select exists (
    select 1
    from public.availability_blockouts b
    where b.blockout_date = p_date
      and b.start_minutes is null
  ) into v_whole_day;

  select exists (
    select 1
    from public.date_availability d
    where d.availability_date = p_date
      and d.start_minutes = p_start_minutes
  ) into v_is_extra;

  if v_whole_day then
    return v_is_extra;
  end if;

  select exists (
    select 1
    from public.weekly_availability w
    where w.day_of_week = p_dow
      and w.start_minutes = p_start_minutes
  ) into v_is_weekly;

  select exists (
    select 1
    from public.availability_blockouts b
    where b.blockout_date = p_date
      and b.start_minutes = p_start_minutes
  ) into v_is_blocked;

  if v_is_extra then
    return true;
  end if;

  return v_is_weekly and not v_is_blocked;
end;
$$;


--
-- Name: tutor_schedule_timezone(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_schedule_timezone() RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  -- Change this if you change TUTOR_SCHEDULE_TIMEZONE in the app config.
  select 'America/Los_Angeles'::text;
$$;


--
-- Name: tutor_start_fits_duration(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_start_fits_duration(p_start timestamp with time zone, p_duration_minutes integer) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_date date;
  v_start_minutes integer;
  v_dow integer;
  v_occupy integer;
  v_m integer;
begin
  select tutor_date, start_minutes, dow
  into v_date, v_start_minutes, v_dow
  from public.tutor_civil_from_start(p_start);

  if v_start_minutes % 15 <> 0 then
    return false;
  end if;

  v_occupy := public.lesson_occupied_minutes(p_duration_minutes);
  v_m := 0;
  while v_m < v_occupy loop
    if not public.tutor_minute_is_open(v_date, v_start_minutes + v_m, v_dow) then
      return false;
    end if;
    v_m := v_m + 15;
  end loop;

  return true;
end;
$$;


--
-- Name: tutor_window_is_open(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tutor_window_is_open(p_start timestamp with time zone, p_end timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  v_date date;
  v_start_minutes integer;
  v_dow integer;
  v_cursor timestamptz;
begin
  if p_end <= p_start then
    return false;
  end if;

  v_cursor := p_start;
  while v_cursor < p_end loop
    select tutor_date, start_minutes, dow
    into v_date, v_start_minutes, v_dow
    from public.tutor_civil_from_start(v_cursor);

    if v_start_minutes % 15 <> 0 then
      return false;
    end if;

    if not public.tutor_minute_is_open(v_date, v_start_minutes, v_dow) then
      return false;
    end if;

    v_cursor := v_cursor + interval '15 minutes';
  end loop;

  return true;
end;
$$;


--
-- Name: update_my_display_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_display_name(p_full_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_trimmed text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_trimmed := trim(coalesce(p_full_name, ''));
  if char_length(v_trimmed) < 1 or char_length(v_trimmed) > 120 then
    raise exception 'Name must be 1–120 characters';
  end if;

  update public.profiles
  set full_name = v_trimmed
  where id = auth.uid()
    and role = 'student';

  if not found then
    raise exception 'Only students can update their display name here';
  end if;
end;
$$;


--
-- Name: update_my_display_timezone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_display_timezone(p_timezone text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_trimmed text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_trimmed := trim(coalesce(p_timezone, ''));
  if char_length(v_trimmed) < 3 or char_length(v_trimmed) > 64 then
    raise exception 'Invalid timezone';
  end if;

  if v_trimmed !~ '^[A-Za-z0-9_]+/[A-Za-z0-9_+-]+$' then
    raise exception 'Invalid timezone';
  end if;

  update public.profiles
  set display_timezone = v_trimmed
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$_$;


--
-- Name: availability_blockouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability_blockouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blockout_date date NOT NULL,
    start_minutes smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    slot_id uuid,
    status text DEFAULT 'booked'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    charged_cents integer,
    completed_at timestamp with time zone,
    duration_minutes integer DEFAULT 60 NOT NULL,
    pay_later boolean DEFAULT false NOT NULL,
    series_id uuid,
    meeting_url text,
    CONSTRAINT bookings_charged_cents_check CHECK (((charged_cents IS NULL) OR (charged_cents > 0))),
    CONSTRAINT bookings_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['booked'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: calendar_feed_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_feed_tokens (
    user_id uuid NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: credit_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    booking_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_ledger_kind_check CHECK ((kind = ANY (ARRAY['payment'::text, 'book_hold'::text, 'cancel_refund'::text, 'duration_adjust'::text, 'adjustment'::text])))
);


--
-- Name: credit_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    CONSTRAINT credit_requests_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT credit_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: date_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.date_availability (
    availability_date date NOT NULL,
    start_minutes smallint NOT NULL,
    CONSTRAINT date_availability_start_minutes_check CHECK (((start_minutes >= 0) AND (start_minutes < 1440)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    kind text DEFAULT 'weekly_skip'::text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    method text DEFAULT 'zelle'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    role text DEFAULT 'student'::text NOT NULL,
    credit_balance_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    class_rate_cents integer DEFAULT 4000 NOT NULL,
    display_timezone text,
    meeting_url text,
    CONSTRAINT profiles_class_rate_cents_check CHECK ((class_rate_cents > 0)),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['student'::text, 'admin'::text])))
);


--
-- Name: weekly_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_availability (
    day_of_week smallint NOT NULL,
    start_minutes smallint NOT NULL,
    CONSTRAINT weekly_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT weekly_availability_start_minutes_check CHECK (((start_minutes >= 0) AND (start_minutes < 1440)))
);


--
-- Name: weekly_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_series (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    duration_minutes integer NOT NULL,
    pay_later boolean DEFAULT false NOT NULL,
    rolling boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    meeting_url text,
    CONSTRAINT weekly_series_duration_minutes_check CHECK ((duration_minutes = ANY (ARRAY[25, 50, 80, 110])))
);


--
-- Name: availability_blockouts availability_blockouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_blockouts
    ADD CONSTRAINT availability_blockouts_pkey PRIMARY KEY (id);


--
-- Name: availability_slots availability_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability_slots
    ADD CONSTRAINT availability_slots_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_slot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_slot_id_key UNIQUE (slot_id);


--
-- Name: calendar_feed_tokens calendar_feed_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feed_tokens
    ADD CONSTRAINT calendar_feed_tokens_pkey PRIMARY KEY (user_id);


--
-- Name: calendar_feed_tokens calendar_feed_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feed_tokens
    ADD CONSTRAINT calendar_feed_tokens_token_key UNIQUE (token);


--
-- Name: credit_ledger credit_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_ledger
    ADD CONSTRAINT credit_ledger_pkey PRIMARY KEY (id);


--
-- Name: credit_requests credit_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_requests
    ADD CONSTRAINT credit_requests_pkey PRIMARY KEY (id);


--
-- Name: date_availability date_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.date_availability
    ADD CONSTRAINT date_availability_pkey PRIMARY KEY (availability_date, start_minutes);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: weekly_availability weekly_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_availability
    ADD CONSTRAINT weekly_availability_pkey PRIMARY KEY (day_of_week, start_minutes);


--
-- Name: weekly_series weekly_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_series
    ADD CONSTRAINT weekly_series_pkey PRIMARY KEY (id);


--
-- Name: availability_blockouts_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX availability_blockouts_unique ON public.availability_blockouts USING btree (blockout_date, COALESCE((start_minutes)::integer, '-1'::integer));


--
-- Name: availability_slots_start_time_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX availability_slots_start_time_uidx ON public.availability_slots USING btree (start_time);


--
-- Name: credit_ledger_student_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_ledger_student_created_idx ON public.credit_ledger USING btree (student_id, created_at DESC);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: weekly_series_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weekly_series_student_idx ON public.weekly_series USING btree (student_id) WHERE ((active = true) AND (rolling = true));


--
-- Name: availability_slots availability_slots_cancel_booking_before_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER availability_slots_cancel_booking_before_delete BEFORE DELETE ON public.availability_slots FOR EACH ROW EXECUTE FUNCTION public.cancel_booking_before_slot_delete();


--
-- Name: bookings bookings_enforce_tutor_schedule; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_enforce_tutor_schedule BEFORE INSERT OR UPDATE OF slot_id, duration_minutes ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_fits_tutor_schedule();


--
-- Name: bookings bookings_fill_meeting_url; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bookings_fill_meeting_url BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.fill_booking_meeting_url();


--
-- Name: bookings on_booking_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_booking_created AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.mark_slot_booked();


--
-- Name: profiles profiles_prevent_admin_promotion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_prevent_admin_promotion BEFORE INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_admin_promotion();


--
-- Name: bookings bookings_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.availability_slots(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_feed_tokens calendar_feed_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feed_tokens
    ADD CONSTRAINT calendar_feed_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: credit_ledger credit_ledger_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_ledger
    ADD CONSTRAINT credit_ledger_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: credit_ledger credit_ledger_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_ledger
    ADD CONSTRAINT credit_ledger_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: credit_requests credit_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_requests
    ADD CONSTRAINT credit_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: credit_requests credit_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_requests
    ADD CONSTRAINT credit_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: payments payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: weekly_series weekly_series_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_series
    ADD CONSTRAINT weekly_series_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles Admin can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: profiles Admin can update profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin());


--
-- Name: availability_blockouts Admin manages blockouts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages blockouts" ON public.availability_blockouts TO authenticated USING (public.is_admin());


--
-- Name: bookings Admin manages bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages bookings" ON public.bookings FOR UPDATE USING (public.is_admin());


--
-- Name: credit_requests Admin manages credit requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages credit requests" ON public.credit_requests TO authenticated USING (public.is_admin());


--
-- Name: date_availability Admin manages date availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages date availability" ON public.date_availability TO authenticated USING (public.is_admin());


--
-- Name: payments Admin manages payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages payments" ON public.payments USING (public.is_admin());


--
-- Name: availability_slots Admin manages slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages slots" ON public.availability_slots USING (public.is_admin());


--
-- Name: weekly_series Admin manages weekly series; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages weekly series" ON public.weekly_series TO authenticated USING (public.is_admin());


--
-- Name: weekly_availability Admin manages weekly template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manages weekly template" ON public.weekly_availability TO authenticated USING (public.is_admin());


--
-- Name: availability_blockouts Anyone logged in can view blockouts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone logged in can view blockouts" ON public.availability_blockouts FOR SELECT TO authenticated USING (true);


--
-- Name: date_availability Anyone logged in can view date availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone logged in can view date availability" ON public.date_availability FOR SELECT TO authenticated USING (true);


--
-- Name: weekly_availability Anyone logged in can view weekly template; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone logged in can view weekly template" ON public.weekly_availability FOR SELECT TO authenticated USING (true);


--
-- Name: availability_slots Logged in users can view slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Logged in users can view slots" ON public.availability_slots FOR SELECT TO authenticated USING (true);


--
-- Name: credit_requests Students can read own credit requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students can read own credit requests" ON public.credit_requests FOR SELECT TO authenticated USING (((auth.uid() = student_id) OR public.is_admin()));


--
-- Name: credit_ledger Students read own credit ledger; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own credit ledger" ON public.credit_ledger FOR SELECT TO authenticated USING (((auth.uid() = student_id) OR public.is_admin()));


--
-- Name: weekly_series Students read own weekly series; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Students read own weekly series" ON public.weekly_series FOR SELECT TO authenticated USING (((auth.uid() = student_id) OR public.is_admin()));


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: bookings Users can view own bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own bookings" ON public.bookings FOR SELECT USING (((auth.uid() = student_id) OR public.is_admin()));


--
-- Name: payments Users can view own payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT USING (((auth.uid() = student_id) OR public.is_admin()));


--
-- Name: notifications Users delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: calendar_feed_tokens Users read own calendar feed token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own calendar feed token" ON public.calendar_feed_tokens FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: notifications Users read own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: availability_blockouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability_blockouts ENABLE ROW LEVEL SECURITY;

--
-- Name: availability_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_feed_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: date_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.date_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: weekly_series; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_series ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


