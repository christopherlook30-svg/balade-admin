-- Balade — migration 0005 : messages « Signaler un problème » envoyés depuis l'app. À lancer après 0001 à 0004.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('problem','idea','other')),
  message text not null check (char_length(message) between 10 and 1000),
  contact text check (contact is null or char_length(contact) <= 100),
  user_id uuid references profiles(id) on delete set null,
  app_version text check (app_version is null or char_length(app_version) <= 20),
  handled boolean not null default false
);
create index if not exists feedback_open_idx on feedback (handled, created_at);
alter table feedback enable row level security;
-- Tout le monde peut écrire un message (lié à son compte s'il est connecté) ; seul le personnel les lit.
create policy feedback_insert on feedback for insert with check (user_id is null or user_id = auth.uid());
create policy feedback_staff_read on feedback for select using (current_role_is('moderator','admin','super_admin'));
create policy feedback_staff_update on feedback for update
  using (current_role_is('moderator','admin','super_admin')) with check (current_role_is('moderator','admin','super_admin'));
