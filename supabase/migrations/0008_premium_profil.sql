-- Balade — migration 0008 : photo de profil, Premium (PawaPay + attribution par l'admin).
-- À lancer après 0006.

-- 1) Profil : photo et statut Premium
alter table profiles add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500);
alter table profiles add column if not exists premium_until timestamptz;
alter table profiles add column if not exists premium_lifetime boolean not null default false;
-- Chacun ne peut modifier que son pseudo et sa photo : jamais son rôle ni son Premium.
revoke update on profiles from authenticated, anon;
grant update (display_name, avatar_url) on profiles to authenticated;

-- 2) Offres, paiements, historique
create table if not exists premium_plans (
  id text primary key, label text not null, days int not null check (days > 0),
  price int not null check (price >= 0), currency text not null default 'XAF',
  sort int not null default 0, active boolean not null default true);
insert into premium_plans (id, label, days, price, sort) values
  ('month', '1 mois', 30, 1000, 1), ('quarter', '3 mois', 90, 2500, 2), ('year', '1 an', 365, 8000, 3)
on conflict (id) do nothing;
create table if not exists premium_payments (
  deposit_id uuid primary key, user_id uuid not null references profiles(id) on delete cascade,
  plan_id text not null references premium_plans(id), amount int not null, currency text not null,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  created_at timestamptz not null default now(), completed_at timestamptz);
create table if not exists premium_grants (
  id bigint generated always as identity primary key, user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('admin','payment')), granted_by uuid references profiles(id) on delete set null,
  unit text, amount int, lifetime boolean not null default false, ends_at timestamptz,
  ref text unique, created_at timestamptz not null default now());
alter table premium_plans enable row level security;
alter table premium_payments enable row level security;
alter table premium_grants enable row level security;
drop policy if exists plans_read on premium_plans;
create policy plans_read on premium_plans for select using (active or current_role_is('admin','super_admin'));
drop policy if exists plans_write on premium_plans;
create policy plans_write on premium_plans for all using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));
drop policy if exists pay_read on premium_payments;
create policy pay_read on premium_payments for select using (user_id = auth.uid() or current_role_is('admin','super_admin'));
drop policy if exists grants_read on premium_grants;
create policy grants_read on premium_grants for select using (user_id = auth.uid() or current_role_is('admin','super_admin'));

-- 3) Attribution par l'admin : jours, semaines, mois, années ou à vie (s'ajoute à un Premium en cours)
create or replace function public.admin_grant_premium(p_user uuid, p_unit text, p_amount int default 1) returns void
language plpgsql security definer set search_path = public as $$
declare base timestamptz; ends timestamptz;
begin
  if not current_role_is('admin','super_admin') then raise exception 'Accès refusé'; end if;
  if p_unit not in ('day','week','month','year','lifetime') then raise exception 'Durée invalide'; end if;
  if p_unit <> 'lifetime' and (p_amount is null or p_amount < 1 or p_amount > 1000) then raise exception 'Quantité invalide (1 à 1000)'; end if;
  if p_unit = 'lifetime' then
    update profiles set premium_lifetime = true where id = p_user;
  else
    select greatest(coalesce(premium_until, now()), now()) into base from profiles where id = p_user;
    ends := base + (p_amount::text || ' ' || p_unit || 's')::interval;
    update profiles set premium_until = ends where id = p_user;
  end if;
  if not found then raise exception 'Compte introuvable'; end if;
  insert into premium_grants (user_id, source, granted_by, unit, amount, lifetime, ends_at)
  values (p_user, 'admin', auth.uid(), p_unit, p_amount, p_unit = 'lifetime', ends);
end $$;
create or replace function public.admin_revoke_premium(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not current_role_is('admin','super_admin') then raise exception 'Accès refusé'; end if;
  update profiles set premium_until = null, premium_lifetime = false where id = p_user;
end $$;
grant execute on function public.admin_grant_premium(uuid, text, int), public.admin_revoke_premium(uuid) to authenticated;

-- 4) Activation après paiement confirmé (appelée uniquement par le serveur, jamais par l'application)
create or replace function public.grant_premium_payment(p_deposit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pay premium_payments; plan premium_plans; base timestamptz; ends timestamptz;
begin
  select * into pay from premium_payments where deposit_id = p_deposit for update;
  if not found then raise exception 'Paiement inconnu'; end if;
  if pay.status = 'completed' then return; end if;
  select * into plan from premium_plans where id = pay.plan_id;
  select greatest(coalesce(premium_until, now()), now()) into base from profiles where id = pay.user_id;
  ends := base + (plan.days || ' days')::interval;
  update profiles set premium_until = ends where id = pay.user_id;
  update premium_payments set status = 'completed', completed_at = now() where deposit_id = p_deposit;
  insert into premium_grants (user_id, source, unit, amount, ends_at, ref) values (pay.user_id, 'payment', 'day', plan.days, ends, p_deposit::text);
end $$;
revoke all on function public.grant_premium_payment(uuid) from public, anon, authenticated;
grant execute on function public.grant_premium_payment(uuid) to service_role;

-- 5) Avis : pseudo complet et photo
drop function if exists public.place_reviews(uuid, int, int);
create function public.place_reviews(p_place uuid, p_limit int default 20, p_offset int default 0)
returns table (id uuid, rating smallint, comment text, created_at timestamptz, author text, author_avatar text, mine boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.rating, r.comment, r.created_at,
         coalesce(nullif(trim(p.display_name), ''), 'Utilisateur') as author, p.avatar_url as author_avatar,
         (r.user_id = auth.uid()) as mine
  from reviews r join profiles p on p.id = r.user_id
  where r.place_id = p_place and r.hidden = false
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;
grant execute on function public.place_reviews(uuid, int, int) to anon, authenticated;

-- 6) Photos de profil (stockage public, 2 Mo, un dossier par utilisateur)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
