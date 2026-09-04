-- Cap notifications at 20 per user; allow delete (run after 21)

create or replace function public.trim_user_notifications(p_user_id uuid, p_keep integer default 20)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.delete_my_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);

grant delete on public.notifications to authenticated;
grant execute on function public.delete_my_notification(uuid) to authenticated;
grant execute on function public.trim_user_notifications(uuid, integer) to authenticated;

-- Trim any existing inboxes over 20
do $$
declare
  v_user uuid;
begin
  for v_user in select distinct user_id from public.notifications loop
    perform public.trim_user_notifications(v_user, 20);
  end loop;
end;
$$;

revoke all on function public.notify_user(uuid, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
