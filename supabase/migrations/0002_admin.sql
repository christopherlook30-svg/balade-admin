-- Balade — migration 0002 : administration, rôles, pubs, réglages, stockage.
-- À lancer APRÈS 0001_core.sql (non testée sur une instance réelle : vérifier les erreurs dans l'éditeur SQL).

-- Profils : e-mail + création automatique à l'inscription
alter table profiles add column if not exists email text;
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, left(split_part(coalesce(new.email, ''), '@', 1), 60))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into profiles (id, email, display_name)
  select id, email, left(split_part(coalesce(email, ''), '@', 1), 60) from auth.users on conflict (id) do nothing;

-- Catégories
alter table categories add column if not exists icon text;
alter table categories add column if not exists sort int not null default 0;
insert into categories (slug, label_fr, sort) values
  ('restaurant','Restos',1),('divertissement','Divertissement',2),('sport','Sport',3),('detente','Détente',4),('tourisme','Tourisme',5)
on conflict (slug) do nothing;

-- Lieux : latitude/longitude simples (la colonne geom PostGIS est calculée)
alter table places add column if not exists lat double precision check (lat between -90 and 90);
alter table places add column if not exists lng double precision check (lng between -180 and 180);
alter table places add column if not exists hours text;
alter table places add column if not exists phone text;
alter table places add column if not exists website text;
alter table places add column if not exists updated_at timestamptz not null default now();
create or replace function public.places_before_write() returns trigger language plpgsql as $$
begin
  if new.lat is not null and new.lng is not null then
    new.geom := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  else
    new.geom := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists places_geom_trg on places;
create trigger places_geom_trg before insert or update on places for each row execute function public.places_before_write();

-- Un seul prix par lieu (le détail se met à jour depuis l'admin)
create unique index if not exists price_ranges_one_per_place on price_ranges (place_id);
alter table place_photos add column if not exists sort int not null default 0;

-- Photos visibles seulement pour les lieux publiés (ou par le personnel)
drop policy if exists photos_read on place_photos;
create policy photos_read on place_photos for select using (
  (rights_confirmed and exists (select 1 from places p where p.id = place_id and p.status = 'published'))
  or current_role_is('moderator','admin','super_admin'));

-- Créateurs partenaires : proposent des lieux (toujours « en attente »)
create policy places_creator_insert on places for insert
  with check (current_role_is('creator') and created_by = auth.uid() and status = 'pending' and is_demo = false);
create policy places_creator_read_own on places for select using (created_by = auth.uid());
create policy places_creator_update_own on places for update
  using (created_by = auth.uid() and status in ('pending','draft'))
  with check (created_by = auth.uid() and status = 'pending');
create policy price_creator_write on price_ranges for all
  using (exists (select 1 from places p where p.id = place_id and p.created_by = auth.uid() and p.status in ('pending','draft')))
  with check (exists (select 1 from places p where p.id = place_id and p.created_by = auth.uid() and p.status in ('pending','draft')));

-- Modération : un modérateur change seulement l'état d'un lieu en attente
create or replace function public.set_place_status(p_id uuid, p_status place_status) returns void
language plpgsql security definer set search_path = public as $$
declare cur place_status;
begin
  if not current_role_is('moderator','admin','super_admin') then raise exception 'Accès refusé'; end if;
  select status into cur from places where id = p_id;
  if cur is null then raise exception 'Lieu introuvable'; end if;
  if not current_role_is('admin','super_admin') and not (cur = 'pending' and p_status in ('published','draft')) then
    raise exception 'Un modérateur ne peut traiter que les lieux en attente';
  end if;
  update places set status = p_status where id = p_id;
end $$;

-- Rôles : seul le super administrateur change le rôle d'un compte
create or replace function public.set_user_role(p_user uuid, p_role user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not current_role_is('super_admin') then raise exception 'Accès refusé'; end if;
  if p_user = auth.uid() and p_role <> 'super_admin' then raise exception 'Vous ne pouvez pas retirer votre propre rôle de super administrateur'; end if;
  update profiles set role = p_role where id = p_user;
end $$;

-- Signalements et soumissions : traçabilité du traitement
alter table reports add column if not exists resolved_by uuid references profiles(id);
alter table reports add column if not exists resolved_at timestamptz;
alter table source_submissions add column if not exists reviewed_note text;
alter table source_submissions add column if not exists reviewed_at timestamptz;

-- Publicités locales
create type ad_placement as enum ('banner','popup','list','map_pin');
create type ad_status as enum ('draft','active','paused','ended');

create table advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  contact_name text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);
create table ads (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid references advertisers(id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  body text check (char_length(body) <= 140),
  cta_label text check (char_length(cta_label) <= 20),
  link_url text check (link_url is null or link_url ~ '^(https://|tel:)'),
  video_url text check (video_url is null or video_url ~ '^https://'),
  image_path text,
  placement ad_placement not null default 'banner',
  city text,
  place_id uuid references places(id) on delete set null,
  weight int not null default 1 check (weight between 1 and 10),
  status ad_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index ads_status_idx on ads (status, placement);
create table ad_billing (
  ad_id uuid primary key references ads(id) on delete cascade,
  price_xaf numeric check (price_xaf >= 0),
  paid boolean not null default false,
  paid_at timestamptz,
  payment_ref text,
  notes text
);
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_settings (key, value) values
  ('ads_enabled','true'), ('popup_max_per_day','1'), ('popup_grace_days','2'),
  ('popup_min_places_opened','2'), ('banner_rotation_seconds','10')
on conflict (key) do nothing;

alter table advertisers enable row level security;
alter table ads enable row level security;
alter table ad_billing enable row level security;
alter table app_settings enable row level security;

create policy advertisers_staff on advertisers for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));
create policy ads_staff on ads for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));
create policy ads_public_read on ads for select using (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
  and coalesce((select value = 'true'::jsonb from app_settings where key = 'ads_enabled'), true));
create policy ad_billing_staff on ad_billing for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));
create policy settings_read on app_settings for select using (true);
create policy settings_write on app_settings for all
  using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));

-- Comptage des affichages et des clics (sans exposer la table)
create or replace function public.track_ad_event(p_ad uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'impression' then
    update ads set impressions = impressions + 1 where id = p_ad and status = 'active';
  elsif p_kind = 'click' then
    update ads set clicks = clicks + 1 where id = p_ad and status = 'active';
  else
    raise exception 'Type d''événement inconnu';
  end if;
end $$;
grant execute on function public.track_ad_event(uuid, text) to anon, authenticated;

-- Stockage des images (lecture publique, écriture réservée aux administrateurs)
insert into storage.buckets (id, name, public) values ('place-photos','place-photos',true), ('ad-media','ad-media',true)
on conflict (id) do nothing;
create policy "media_read" on storage.objects for select using (bucket_id in ('place-photos','ad-media'));
create policy "media_insert" on storage.objects for insert
  with check (bucket_id in ('place-photos','ad-media') and public.current_role_is('admin','super_admin'));
create policy "media_update" on storage.objects for update
  using (bucket_id in ('place-photos','ad-media') and public.current_role_is('admin','super_admin'));
create policy "media_delete" on storage.objects for delete
  using (bucket_id in ('place-photos','ad-media') and public.current_role_is('admin','super_admin'));
