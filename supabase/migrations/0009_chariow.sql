-- Balade — migration 0009 : paiement Premium via Chariow. Elle ne fait qu'AJOUTER (rien n'est supprimé).
-- À lancer dans le SQL Editor de Supabase, après 0008.

-- Réglages : moyen de paiement actif ('off' = fermé, 'chariow', 'momo') et offre utilisée avec Chariow.
insert into app_settings (key, value) values ('premium_provider', '"off"'::jsonb), ('chariow_plan_id', '"month"'::jsonb)
on conflict (key) do nothing;

-- Une vente Chariow = un utilisateur + une offre + le montant attendu (relevé auprès de Chariow à la création).
create table if not exists chariow_sales (
  sale_id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id text not null references premium_plans(id),
  expected_amount numeric not null,
  expected_currency text not null,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','completed','failed','abandoned','mismatch')),
  failure_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
-- Historique des notifications (anti-doublon : un identifiant de livraison n'est traité qu'une fois).
create table if not exists chariow_deliveries (
  delivery_id text primary key,
  event text,
  sale_id text,
  outcome text,
  received_at timestamptz not null default now()
);
-- Anomalies à examiner dans l'admin (montant différent, produit inattendu, vente inconnue…).
create table if not exists chariow_alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  message text not null,
  sale_id text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table chariow_sales enable row level security;
alter table chariow_deliveries enable row level security;
alter table chariow_alerts enable row level security;
drop policy if exists chariow_sales_read on chariow_sales;
create policy chariow_sales_read on chariow_sales for select using (user_id = auth.uid() or current_role_is('admin','super_admin'));
drop policy if exists chariow_deliveries_read on chariow_deliveries;
create policy chariow_deliveries_read on chariow_deliveries for select using (current_role_is('admin','super_admin'));
drop policy if exists chariow_alerts_read on chariow_alerts;
create policy chariow_alerts_read on chariow_alerts for select using (current_role_is('admin','super_admin'));
drop policy if exists chariow_alerts_update on chariow_alerts;
create policy chariow_alerts_update on chariow_alerts for update using (current_role_is('admin','super_admin')) with check (current_role_is('admin','super_admin'));
-- Aucune écriture possible depuis l'application : seul le serveur (service_role) crée et modifie les ventes.

-- Offre affichée dans l'app : moyen de paiement + offre Chariow (le prix est recopié depuis Chariow par le serveur).
create or replace function public.premium_offer() returns table (provider text, plan_id text, label text, days int, price int, currency text)
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from app_settings where key = 'premium_provider'), 'off'),
         p.id, p.label, p.days, p.price, p.currency
  from (select 1) x
  left join premium_plans p on p.active and p.id = coalesce((select value #>> '{}' from app_settings where key = 'chariow_plan_id'), 'month')
$$;
grant execute on function public.premium_offer() to anon, authenticated;

-- Activation après paiement vérifié par le serveur : une seule fois par vente, durée ajoutée au Premium en cours.
create or replace function public.grant_premium_chariow(p_sale text, p_amount numeric, p_currency text) returns text
language plpgsql security definer set search_path = public as $$
declare s chariow_sales; plan premium_plans; base timestamptz; ends timestamptz;
begin
  select * into s from chariow_sales where sale_id = p_sale for update;
  if not found then return 'unknown'; end if;
  if s.status = 'completed' then return 'already'; end if;
  if p_amount is distinct from s.expected_amount then
    update chariow_sales set status = 'mismatch' where sale_id = p_sale;
    insert into chariow_alerts (kind, message, sale_id)
    values ('mismatch', 'Montant payé ' || p_amount || ' ' || coalesce(p_currency, '') || ' différent du montant attendu ' || s.expected_amount, p_sale);
    return 'mismatch';
  end if;
  select * into plan from premium_plans where id = s.plan_id;
  select greatest(coalesce(premium_until, now()), now()) into base from profiles where id = s.user_id;
  ends := base + (plan.days || ' days')::interval;
  update profiles set premium_until = ends where id = s.user_id;
  update chariow_sales set status = 'completed', completed_at = now() where sale_id = p_sale;
  insert into premium_grants (user_id, source, unit, amount, ends_at, ref) values (s.user_id, 'payment', 'day', plan.days, ends, 'chariow:' || p_sale);
  return 'granted';
end $$;
revoke all on function public.grant_premium_chariow(text, numeric, text) from public, anon, authenticated;
grant execute on function public.grant_premium_chariow(text, numeric, text) to service_role;
