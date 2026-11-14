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
