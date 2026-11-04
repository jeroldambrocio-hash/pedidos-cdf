-- Profiles and availability.
-- 1) Each member has a photo, a phone and an absence (from / until / reason). They edit their own profile;
--    an admin can set anyone's availability. "until" is the last day away; with no "until" they stay away
--    until someone changes it. Availability is worked out on the day in Manila, so a future absence
--    still shows them as available until it starts.
-- 2) Who completed each order: prepared_by (marked it Ready) and delivered_by (marked it Delivered),
--    set by the server once per order, never by the client. "Completed orders" counts each delivered
--    order once per person who prepared or delivered it.

alter table public.cdf_members
  add column phone text not null default '',
  add column avatar_path text,
  add column away_from date,
  add column away_until date,
  add column away_reason text,
  add constraint cdf_members_away_ok check (away_until is null or (away_from is not null and away_until >= away_from)),
  add constraint cdf_members_reason_ok check (away_reason is null or away_reason in ('vacation', 'rest', 'other'));

alter table public.cdf_orders add column prepared_by text, add column delivered_by text;

-- The office acting on behalf of the assigned florist or driver credits them, not itself.
create function public.cdf_credit_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_by text := nullif(lower(coalesce(auth.jwt()->>'email', '')), '');
  v_role text := public.cdf_my_role();
begin
  if tg_op = 'INSERT' then
    new.prepared_by := null; new.delivered_by := null;
    if new.status = 'Ready' then new.prepared_by := coalesce(new.vendor_email, v_by); end if;
    if new.delivery = 'Delivered' then new.delivered_by := coalesce(new.carrier_email, v_by); end if;
    return new;
  end if;
  new.prepared_by := old.prepared_by; new.delivered_by := old.delivered_by;
  if new.status = 'Ready' and old.status is distinct from 'Ready' and new.prepared_by is null then
    new.prepared_by := case when v_role = 'vendor' then v_by else coalesce(new.vendor_email, v_by) end;
  elsif new.status is distinct from 'Ready' then
    new.prepared_by := null; -- sent back to Preparing: it will be credited again when it is ready
  end if;
  if new.delivery = 'Delivered' and old.delivery is distinct from 'Delivered' and new.delivered_by is null then
    new.delivered_by := case when v_role = 'carrier' then v_by else coalesce(new.carrier_email, v_by) end;
  elsif new.delivery is distinct from 'Delivered' then
    new.delivered_by := null;
  end if;
  return new;
end $$;
create trigger cdf_orders_credit before insert or update on public.cdf_orders
  for each row execute function public.cdf_credit_order();

-- Past orders: the first "Ready" / "Delivered" change in the history, else the assigned person.
-- Orders from before the change history (migration 012) can only use the assigned florist / driver.
update public.cdf_orders o set prepared_by = coalesce(o.vendor_email, (
  select e.by_email from public.cdf_order_events e
  where e.order_id = o.id and e.changes->'status'->>1 = 'Ready' order by e.at limit 1))
where o.status = 'Ready';
update public.cdf_orders o set delivered_by = coalesce(o.carrier_email, (
  select e.by_email from public.cdf_order_events e
  where e.order_id = o.id and e.changes->'delivery'->>1 = 'Delivered' order by e.at limit 1))
where o.delivery = 'Delivered';

-- Own profile: name, phone and photo (the photo must sit in the person's own folder).
create function public.cdf_save_profile(p_name text, p_phone text, p_avatar text)
returns public.cdf_members language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email', '')); r public.cdf_members;
begin
  if public.cdf_my_role() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if p_avatar is not null and split_part(p_avatar, '/', 1) <> auth.uid()::text then
    raise exception 'bad avatar path' using errcode = '22023';
  end if;
  update public.cdf_members set name = left(trim(p_name), 80), phone = left(coalesce(trim(p_phone), ''), 32), avatar_path = p_avatar
  where email = v_email returning * into r;
  return r;
end $$;

-- Availability: your own, or anyone's if you are an admin. p_from null = available again.
create function public.cdf_set_availability(p_email text, p_from date, p_until date, p_reason text)
returns public.cdf_members language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email', '')); r public.cdf_members;
begin
  if not (public.cdf_is_admin() or (lower(p_email) = v_email and public.cdf_my_role() is not null)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null then
    update public.cdf_members set away_from = null, away_until = null, away_reason = null where email = lower(p_email) returning * into r;
  else
    if p_until is not null and p_until < p_from then raise exception 'end before start' using errcode = '22023'; end if;
    update public.cdf_members set away_from = p_from, away_until = p_until, away_reason = nullif(p_reason, '')
    where email = lower(p_email) returning * into r;
  end if;
  if r.email is null then raise exception 'no such member' using errcode = '22023'; end if;
  return r;
end $$;

-- Pending orders whose date falls inside their florist's absence (for the admin's warning).
create function public.cdf_away_conflicts()
returns table(id uuid, num text, date date, vendor_email text, away_from date, away_until date)
language sql stable security definer set search_path = '' as $$
  select o.id, o.num, o.date, o.vendor_email, m.away_from, m.away_until
  from public.cdf_orders o join public.cdf_members m on m.email = o.vendor_email
  where public.cdf_is_staff() and o.archived_at is null and o.delivery is distinct from 'Delivered'
    and m.away_from is not null and o.date >= m.away_from and (m.away_until is null or o.date <= m.away_until)
  order by o.date, o.slot
$$;

-- Completed orders: each delivered order once per person who prepared or delivered it.
create or replace function public.cdf_member_stats()
returns table(email text, done_total bigint, done_month bigint, done_week bigint, open_now bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select public.cdf_my_role() as role, lower(coalesce(auth.jwt()->>'email', '')) as email),
       today as (select (now() at time zone 'Asia/Manila')::date as d)
  select m.email,
    count(distinct o.id) filter (where o.delivery = 'Delivered'),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date >= date_trunc('month', (select d from today))::date and o.date <= (select d from today)),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date > (select d from today) - 7 and o.date <= (select d from today)),
    (select count(*) from public.cdf_orders p where p.archived_at is null and p.delivery is distinct from 'Delivered'
      and (p.vendor_email = m.email or p.carrier_email = m.email))
  from public.cdf_members m cross join me
  left join public.cdf_orders o on (o.prepared_by = m.email or o.delivered_by = m.email)
  where me.role in ('admin', 'moderator') or m.email = me.email
  group by m.email
$$;

revoke all on function public.cdf_save_profile(text, text, text), public.cdf_set_availability(text, date, date, text),
  public.cdf_away_conflicts(), public.cdf_credit_order() from public, anon;
grant execute on function public.cdf_save_profile(text, text, text), public.cdf_set_availability(text, date, date, text),
  public.cdf_away_conflicts() to authenticated;

-- Profile photos: private bucket; each person writes only their own folder (their user id);
-- the office and the person themselves can see them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-avatars', 'cdf-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);
create policy cdf_avatars_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'cdf-avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.cdf_my_role() is not null);
create policy cdf_avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'cdf-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cdf_avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cdf-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cdf_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.cdf_is_staff()));
