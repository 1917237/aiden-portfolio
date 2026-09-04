-- Let students see occupied times (not who booked) so calendars hide taken slots.
-- Run after 22.

create or replace function public.list_occupied_booking_ranges()
returns table (
  start_time timestamptz,
  end_time timestamptz,
  duration_minutes integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.start_time,
    s.end_time,
    coalesce(b.duration_minutes, 50) as duration_minutes
  from public.bookings b
  join public.availability_slots s on s.id = b.slot_id
  where b.status = 'booked';
$$;

grant execute on function public.list_occupied_booking_ranges() to authenticated;

notify pgrst, 'reload schema';
