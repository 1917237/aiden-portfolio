-- Portfolio CMS (admin-editable site + projects)
-- Run once on the live Supabase project (SQL Editor). Idempotent.

create table if not exists public.portfolio_site (
  id int primary key default 1 check (id = 1),
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sort_order int not null default 0,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_projects_sort_idx
  on public.portfolio_projects (sort_order asc, slug asc);

alter table public.portfolio_site enable row level security;
alter table public.portfolio_projects enable row level security;

-- Table privileges (RLS alone is not enough — without GRANT you get 42501)
grant select on public.portfolio_site to anon, authenticated;
grant insert, update, delete on public.portfolio_site to authenticated;

grant select on public.portfolio_projects to anon, authenticated;
grant insert, update, delete on public.portfolio_projects to authenticated;

drop policy if exists "Public read portfolio site" on public.portfolio_site;
create policy "Public read portfolio site"
  on public.portfolio_site for select
  using (true);

drop policy if exists "Admin write portfolio site" on public.portfolio_site;
create policy "Admin write portfolio site"
  on public.portfolio_site for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public read portfolio projects" on public.portfolio_projects;
create policy "Public read portfolio projects"
  on public.portfolio_projects for select
  using (true);

drop policy if exists "Admin write portfolio projects" on public.portfolio_projects;
create policy "Admin write portfolio projects"
  on public.portfolio_projects for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Public media bucket for covers / gallery
insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read portfolio media" on storage.objects;
create policy "Public read portfolio media"
  on storage.objects for select
  using (bucket_id = 'portfolio');

drop policy if exists "Admin upload portfolio media" on storage.objects;
create policy "Admin upload portfolio media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'portfolio' and public.is_admin());

drop policy if exists "Admin update portfolio media" on storage.objects;
create policy "Admin update portfolio media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'portfolio' and public.is_admin())
  with check (bucket_id = 'portfolio' and public.is_admin());

drop policy if exists "Admin delete portfolio media" on storage.objects;
create policy "Admin delete portfolio media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'portfolio' and public.is_admin());
