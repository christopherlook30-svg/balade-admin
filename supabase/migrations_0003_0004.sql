-- Balade — migration 0003 : statistiques anonymes, statut en direct, rapports par période.
-- À lancer APRÈS 0001 et 0002 (non testée sur une instance réelle : vérifier les erreurs dans l'éditeur SQL).

create table if not exists app_devices (
  device_id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists app_active_daily (
  day date not null,
  device_id uuid not null,
  primary key (day, device_id)
);
create table if not exists app_daily (
  day date not null,
  kind text not null check (kind in ('session','place_view','route_start')),
  place_id uuid not null default '00000000-0000-0000-0000-000000000000',
  n int not null default 0,
  primary key (day, kind, place_id)
);
create table if not exists ad_daily (
  day date not null,
  ad_id uuid not null references ads(id) on delete cascade,
  impressions int not null default 0,
  clicks int not null default 0,
  primary key (day, ad_id)
);
-- Aucune règle d'accès direct : tout passe par les fonctions ci-dessous.
alter table app_devices enable row level security;
alter table app_active_daily enable row level security;
alter table app_daily enable row level security;
alter table ad_daily enable row level security;

-- Test de disponibilité du serveur (utilisé par la page « Statut »)
create or replace function public.ping() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon, authenticated;

-- Événements anonymes envoyés par l'app (identifiant aléatoire, aucune position, aucune donnée personnelle)
create or replace function public.track_app_event(p_device uuid, p_kind text, p_place uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Brazzaville')::date;
begin
  if p_device is null or p_kind not in ('session','ping','place_view','route_start') then
    raise exception 'Événement invalide';
  end if;
  insert into app_devices (device_id) values (p_device)
    on conflict (device_id) do update set last_seen = now();
  insert into app_active_daily (day, device_id) values (d, p_device) on conflict do nothing;
  if p_kind <> 'ping' then
    insert into app_daily (day, kind, place_id, n)
      values (d, p_kind, coalesce(p_place, '00000000-0000-0000-0000-000000000000'::uuid), 1)
      on conflict (day, kind, place_id) do update set n = app_daily.n + 1;
  end if;
end $$;
grant execute on function public.track_app_event(uuid, text, uuid) to anon, authenticated;

-- Comptage des pubs : totaux + détail par jour
create or replace function public.track_ad_event(p_ad uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Brazzaville')::date;
begin
  if p_kind not in ('impression','click') then raise exception 'Type d''événement inconnu'; end if;
  if not exists (select 1 from ads where id = p_ad and status = 'active') then return; end if;
  if p_kind = 'impression' then
    update ads set impressions = impressions + 1 where id = p_ad;
    insert into ad_daily (day, ad_id, impressions) values (d, p_ad, 1)
      on conflict (day, ad_id) do update set impressions = ad_daily.impressions + 1;
  else
    update ads set clicks = clicks + 1 where id = p_ad;
    insert into ad_daily (day, ad_id, clicks) values (d, p_ad, 1)
      on conflict (day, ad_id) do update set clicks = ad_daily.clicks + 1;
  end if;
end $$;
grant execute on function public.track_ad_event(uuid, text) to anon, authenticated;

-- Statut en direct (personnel de l'administration uniquement)
create or replace function public.live_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Brazzaville')::date;
begin
  if not current_role_is('moderator','admin','super_admin') then raise exception 'Accès refusé'; end if;
  return jsonb_build_object(
    'server_time', now(),
    'online_15m', (select count(*) from app_devices where last_seen > now() - interval '15 minutes'),
    'sessions_today', coalesce((select sum(n) from app_daily where kind = 'session' and day = d), 0),
    'devices_total', (select count(*) from app_devices),
    'places_published', (select count(*) from places where status = 'published' and is_demo = false),
    'ads_active', (select count(*) from ads where status = 'active'),
    'ads_enabled', coalesce((select value = 'true'::jsonb from app_settings where key = 'ads_enabled'), true),
    'last_event_at', (select max(last_seen) from app_devices),
    'last_place_at', (select max(created_at) from places where status = 'published' and is_demo = false));
end $$;

-- Rapport sur une période (dates incluses)
create or replace function public.report_period(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tz text := 'Africa/Brazzaville'; r jsonb;
begin
  if not current_role_is('moderator','admin','super_admin') then raise exception 'Accès refusé'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Période invalide'; end if;
  select jsonb_build_object(
    'sessions', coalesce((select sum(n) from app_daily where kind = 'session' and day between p_from and p_to), 0),
    'place_views', coalesce((select sum(n) from app_daily where kind = 'place_view' and day between p_from and p_to), 0),
    'route_starts', coalesce((select sum(n) from app_daily where kind = 'route_start' and day between p_from and p_to), 0),
    'active_devices', (select count(distinct device_id) from app_active_daily where day between p_from and p_to),
    'new_devices', (select count(*) from app_devices where (first_seen at time zone tz)::date between p_from and p_to),
    'ad_impressions', coalesce((select sum(impressions) from ad_daily where day between p_from and p_to), 0),
    'ad_clicks', coalesce((select sum(clicks) from ad_daily where day between p_from and p_to), 0),
    'new_places', (select count(*) from places where is_demo = false and (created_at at time zone tz)::date between p_from and p_to),
    'new_reviews', (select count(*) from reviews where (created_at at time zone tz)::date between p_from and p_to),
    'new_reports', (select count(*) from reports where (created_at at time zone tz)::date between p_from and p_to),
    'new_submissions', (select count(*) from source_submissions where (created_at at time zone tz)::date between p_from and p_to),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date, 'sessions', coalesce(s.n, 0), 'devices', coalesce(a.c, 0)) order by g.d), '[]'::jsonb)
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
      left join (select day, sum(n) as n from app_daily where kind = 'session' group by day) s on s.day = g.d::date
      left join (select day, count(*) as c from app_active_daily group by day) a on a.day = g.d::date),
    'top_places', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select p.name, sum(x.n) as views from app_daily x join places p on p.id = x.place_id
        where x.kind = 'place_view' and x.day between p_from and p_to group by p.name order by views desc limit 10) t),
    'top_ads', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select a.title, sum(x.impressions) as impressions, sum(x.clicks) as clicks from ad_daily x join ads a on a.id = x.ad_id
        where x.day between p_from and p_to group by a.title order by impressions desc limit 10) t)
  ) into r;
  return r;
end $$;
revoke execute on function public.live_status() from public, anon;
revoke execute on function public.report_period(date, date) from public, anon;
grant execute on function public.live_status() to authenticated;
grant execute on function public.report_period(date, date) to authenticated;

-- Balade — migration 0004 : comptes, avis et étoiles. À lancer APRÈS 0001, 0002 et 0003.

-- Pseudo choisi à l'inscription (sinon, début de l'e-mail)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 60))
  on conflict (id) do nothing;
  return new;
end $$;

-- Note moyenne conservée sur chaque lieu (lecture rapide pour l'app)
alter table places add column if not exists rating_avg numeric(3,2);
alter table places add column if not exists rating_count int not null default 0;
create or replace function public.refresh_place_rating(p_place uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update places set
    rating_count = (select count(*) from reviews where place_id = p_place and hidden = false),
    rating_avg = (select round(avg(rating)::numeric, 2) from reviews where place_id = p_place and hidden = false)
  where id = p_place;
end $$;
create or replace function public.reviews_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform refresh_place_rating(new.place_id); end if;
  if tg_op = 'DELETE' then perform refresh_place_rating(old.place_id); end if;
  if tg_op = 'UPDATE' and old.place_id <> new.place_id then perform refresh_place_rating(old.place_id); end if;
  return null;
end $$;
drop trigger if exists reviews_rating_trg on reviews;
create trigger reviews_rating_trg after insert or update or delete on reviews for each row execute function public.reviews_after_change();

-- Anti-spam : 5 avis par jour et par compte au maximum
create or replace function public.reviews_before_insert() returns trigger language plpgsql as $$
begin
  new.comment := nullif(trim(coalesce(new.comment, '')), '');
  if (select count(*) from reviews where user_id = new.user_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Trop d''avis récents : réessayez demain.';
  end if;
  return new;
end $$;
drop trigger if exists reviews_spam_trg on reviews;
create trigger reviews_spam_trg before insert on reviews for each row execute function public.reviews_before_insert();

-- Règles d'accès : on ne note que les lieux publiés ; chacun gère son propre avis
drop policy if exists rev_insert on reviews;
create policy rev_insert on reviews for insert
  with check (user_id = auth.uid() and exists (select 1 from places p where p.id = place_id and p.status = 'published'));
drop policy if exists rev_delete_own on reviews;
create policy rev_delete_own on reviews for delete using (user_id = auth.uid());

-- Lecture publique des avis avec le pseudo (jamais l'e-mail)
create or replace function public.place_reviews(p_place uuid, p_limit int default 20, p_offset int default 0)
returns table (id uuid, rating smallint, comment text, created_at timestamptz, author text, mine boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.rating, r.comment, r.created_at,
         coalesce(nullif(split_part(p.display_name, ' ', 1), ''), 'Utilisateur') as author,
         (r.user_id = auth.uid()) as mine
  from reviews r join profiles p on p.id = r.user_id
  where r.place_id = p_place and r.hidden = false
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;
create or replace function public.place_rating_breakdown(p_place uuid) returns table (rating smallint, n bigint)
language sql stable security definer set search_path = public as $$
  select rating, count(*) from reviews where place_id = p_place and hidden = false group by rating
$$;
grant execute on function public.place_reviews(uuid, int, int) to anon, authenticated;
grant execute on function public.place_rating_breakdown(uuid) to anon, authenticated;

-- Signalement d'un avis abusif
alter table reports add column if not exists review_id uuid references reviews(id) on delete cascade;
alter table reports drop constraint if exists reports_reason_check;
alter table reports add constraint reports_reason_check check (reason in ('wrong_info','closed','wrong_price','other','abusive_review'));
create unique index if not exists reports_one_per_review on reports (user_id, review_id) where review_id is not null;

-- Suppression de son propre compte (avis et favoris supprimés avec lui)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Non connecté'; end if;
  if exists (select 1 from profiles where id = auth.uid() and role = 'super_admin')
     and (select count(*) from profiles where role = 'super_admin') <= 1 then
    raise exception 'Vous êtes le seul super administrateur : nommez-en un autre avant de supprimer ce compte';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

select public.refresh_place_rating(id) from places;
