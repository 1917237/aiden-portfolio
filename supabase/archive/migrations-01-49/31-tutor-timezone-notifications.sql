-- Notification times use tutor_schedule_timezone() (keep in sync with
-- src/tutoring/config.ts → TUTOR_SCHEDULE_TIMEZONE). Run after 30.

create or replace function public.tutor_schedule_timezone()
returns text
language sql
immutable
parallel safe
as $$
  -- Change this if you change TUTOR_SCHEDULE_TIMEZONE in the app config.
  select 'America/Los_Angeles'::text;
$$;

create or replace function public.format_lesson_when(p_start timestamptz)
returns text
language sql
stable
parallel safe
set search_path = public
as $$
  select trim(
    to_char(
      p_start at time zone public.tutor_schedule_timezone(),
      'Dy Mon FMDD, FMHH12:MI AM'
    )
  )
  || ' '
  || replace(split_part(public.tutor_schedule_timezone(), '/', 2), '_', ' ');
$$;

grant execute on function public.tutor_schedule_timezone() to authenticated;
grant execute on function public.format_lesson_when(timestamptz) to authenticated;

notify pgrst, 'reload schema';
