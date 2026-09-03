-- Remove duplicate open slots that sit on top of already-booked times (run after 16)

delete from public.availability_slots u
where u.is_booked = false
  and exists (
    select 1
    from public.availability_slots o
    join public.bookings b on b.slot_id = o.id and b.status = 'booked'
    where o.start_time = u.start_time
      and o.id <> u.id
  );

delete from public.availability_slots u
where u.is_booked = false
  and exists (
    select 1
    from public.availability_slots o
    where o.start_time = u.start_time
      and o.id <> u.id
      and o.is_booked = true
  );

-- Also hide open slots that overlap an active booking's time range
delete from public.availability_slots u
where u.is_booked = false
  and exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.status = 'booked'
      and tstzrange(u.start_time, u.end_time, '[)') && tstzrange(s.start_time, s.end_time, '[)')
  );
