-- Safer slot/booking link + optional tutor note on admin cancel. Run after 31.

-- ---------------------------------------------------------------------------
-- 1) Stop CASCADE: deleting a slot no longer silently deletes the booking row.
--    If a booked class is on that slot, cancel it properly first; then the
--    booking keeps its history with slot_id cleared.
-- ---------------------------------------------------------------------------
alter table public.bookings
  drop constraint if exists bookings_slot_id_fkey;

alter table public.bookings
  alter column slot_id drop not null;

alter table public.bookings
  add constraint bookings_slot_id_fkey
  foreign key (slot_id)
  references public.availability_slots (id)
  on delete set null;

create or replace function public.cancel_booking_core(
  p_booking_id uuid,
  p_comment text default null,
  p_notify boolean default true
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
        end_time = v_start + interval '60 minutes'
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

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_comment text default null
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

  perform public.lock_booking_calendar();
  perform public.cancel_booking_core(p_booking_id, p_comment, true);
end;
$$;

grant execute on function public.cancel_booking(uuid, text) to authenticated;

create or replace function public.cancel_booking_before_slot_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists availability_slots_cancel_booking_before_delete on public.availability_slots;

create trigger availability_slots_cancel_booking_before_delete
  before delete on public.availability_slots
  for each row
  execute function public.cancel_booking_before_slot_delete();

revoke all on function public.cancel_booking_core(uuid, text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
