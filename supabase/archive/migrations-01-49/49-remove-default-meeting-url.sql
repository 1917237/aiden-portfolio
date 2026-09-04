-- Remove leftover global default meeting URL autofill.
-- Safe to run even if 48 was already applied earlier.
-- New bookings only inherit meeting_url from their weekly_series (if any).

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

revoke all on function public.fill_booking_meeting_url() from public, anon, authenticated;

drop function if exists public.admin_set_default_meeting_url(text);

-- Clear any stale admin default so it cannot be reused accidentally.
update public.profiles
set meeting_url = null
where role = 'admin'
  and meeting_url is not null;

notify pgrst, 'reload schema';
