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
