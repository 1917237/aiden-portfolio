-- Admins were seeing every student's notification (e.g. "Class cancelled by your tutor")
-- because the select policy allowed is_admin() to read all rows.
-- Tutor inbox should only show notifications addressed to them (notify_admins).

drop policy if exists "Users read own notifications" on public.notifications;

create policy "Users read own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
