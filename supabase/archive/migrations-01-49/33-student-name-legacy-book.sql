-- Student display name + legacy book fix + tighten notification RPCs. Run after 32.

-- ---------------------------------------------------------------------------
-- 1) Students can update their own display name (not role/credits/rate).
-- ---------------------------------------------------------------------------
create or replace function public.update_my_display_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.update_my_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Legacy student_book_slot used invalid duration 60 (allowed: 25/50/80/110).
-- ---------------------------------------------------------------------------
create or replace function public.student_book_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  v_ids := public.student_book_lesson(p_slot_id, 50, false, false);
  return v_ids[1];
end;
$$;

grant execute on function public.student_book_slot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Stop client-callable notification spam helpers (server uses notify_user).
-- ---------------------------------------------------------------------------
revoke execute on function public.add_student_notification(text, text, text) from authenticated;
revoke execute on function public.student_notify_booking_summary(boolean, integer, boolean, timestamptz[]) from authenticated;

notify pgrst, 'reload schema';
