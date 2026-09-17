-- Fix: portfolio CMS permission denied (42501)
-- Run this once in Supabase SQL Editor if Seed/Save fails with permission denied.

grant select on public.portfolio_site to anon, authenticated;
grant insert, update, delete on public.portfolio_site to authenticated;

grant select on public.portfolio_projects to anon, authenticated;
grant insert, update, delete on public.portfolio_projects to authenticated;
