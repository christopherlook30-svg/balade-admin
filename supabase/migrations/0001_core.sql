-- BonPlan — migration 0001 : socle (non testée sur une instance Supabase réelle)
create extension if not exists postgis;

create type user_role as enum ('super_admin','admin','moderator','creator','user');
create type price_basis as enum ('per_person','per_group','free','unknown');
create type price_kind as enum ('exact','minimum','range','estimated');
create type place_status as enum ('draft','pending','published','archived');
create type verification_status as enum ('unverified','declared','verified');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  role user_role not null default 'user',
  created_at timestamptz not null default now()
);

create table categories (
  id serial primary key,
  slug text not null unique,
  label_fr text not null
);

create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  category_id int references categories(id),
  city text not null,
  neighborhood text,
  address text,
  geom geography(point,4326),
  status place_status not null default 'pending',
  verification verification_status not null default 'unverified',
  is_demo boolean not null default false,       -- jamais mélangé aux lieux réels
  source_url text,
  last_verified_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index places_geom_idx on places using gist (geom);
create index places_city_status_idx on places (city, status);

create table price_ranges (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  basis price_basis not null,
  kind price_kind,
  min_amount numeric check (min_amount >= 0),
  max_amount numeric check (max_amount >= min_amount),
  extra_fees numeric not null default 0 check (extra_fees >= 0),
  currency char(3) not null default 'XAF',
  note text,
  check (basis in ('free','unknown') or (min_amount is not null and kind is not null))
);
create index price_ranges_place_idx on price_ranges (place_id);

create table place_photos (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  storage_path text not null,
  credit text,
  rights_confirmed boolean not null default false
);

create table favorites (
  user_id uuid references profiles(id) on delete cascade,
  place_id uuid references places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (place_id, user_id)                      -- anti-spam : un avis par lieu et par compte
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  reason text not null check (reason in ('wrong_info','closed','wrong_price','other')),
  details text check (char_length(details) <= 1000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table source_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references profiles(id) on delete set null,
  url text,
  network text,
  proposed_name text,
  proposed_city text,
  notes text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Rôle courant (security definer : évite la récursion RLS)
create function public.current_role_is(variadic roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = any(roles));
$$;

alter table profiles enable row level security;
alter table categories enable row level security;
alter table places enable row level security;
alter table price_ranges enable row level security;
alter table place_photos enable row level security;
alter table favorites enable row level security;
alter table reviews enable row level security;
alter table reports enable row level security;
alter table source_submissions enable row level security;

create policy cat_read on categories for select using (true);
create policy cat_write on categories for all using (current_role_is('admin','super_admin'));

create policy places_read on places for select
  using (status = 'published' or current_role_is('moderator','admin','super_admin'));
create policy places_write on places for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));

create policy price_read on price_ranges for select using (
  exists (select 1 from places p where p.id = place_id and p.status = 'published')
  or current_role_is('moderator','admin','super_admin'));
create policy price_write on price_ranges for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));

create policy photos_read on place_photos for select using (rights_confirmed or current_role_is('moderator','admin','super_admin'));
create policy photos_write on place_photos for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));

create policy profiles_self_read on profiles for select using (id = auth.uid() or current_role_is('admin','super_admin'));
create policy profiles_self_update on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())); -- pas d'auto-promotion

create policy fav_own on favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy rev_read on reviews for select using (not hidden or current_role_is('moderator','admin','super_admin'));
create policy rev_insert on reviews for insert with check (user_id = auth.uid());
create policy rev_update_own on reviews for update using (user_id = auth.uid()) with check (user_id = auth.uid() and hidden = false);
create policy rev_moderate on reviews for update using (current_role_is('moderator','admin','super_admin'));

create policy rep_insert on reports for insert with check (user_id = auth.uid());
create policy rep_staff on reports for select using (current_role_is('moderator','admin','super_admin'));
create policy rep_staff_upd on reports for update using (current_role_is('moderator','admin','super_admin'));

create policy sub_insert on source_submissions for insert with check (submitted_by = auth.uid());
create policy sub_own_read on source_submissions for select using (submitted_by = auth.uid() or current_role_is('moderator','admin','super_admin'));
create policy sub_staff_upd on source_submissions for update using (current_role_is('moderator','admin','super_admin'));
