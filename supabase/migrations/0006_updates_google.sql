-- Balade — migration 0006 : avertissement de mise à jour + pseudo pris depuis Google. À lancer après 0001 à 0005.
insert into app_settings (key, value) values
  ('latest_version', '"1.0.0"'), ('download_url', '""'), ('release_notes', '""')
on conflict (key) do nothing;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1)), 60))
  on conflict (id) do nothing;
  return new;
end $$;
