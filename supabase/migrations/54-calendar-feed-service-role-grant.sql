-- Fix calendar sync: allow the calendar-feed edge function (service role)
-- to call get_calendar_feed_events. Public access is still gated by the
-- private feed token inside the function.
--
-- Run once in Supabase → SQL Editor.

grant execute on function public.get_calendar_feed_events(uuid) to service_role;

notify pgrst, 'reload schema';
