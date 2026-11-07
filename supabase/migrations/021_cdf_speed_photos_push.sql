-- 1) Faster row checks: auth.jwt() evaluated once per query instead of once per row (Supabase lint 0003).
--    Same rules as before, only wrapped in (select …).
drop policy cdf_orders_vendor_read on public.cdf_orders;
create policy cdf_orders_vendor_read on public.cdf_orders for select to authenticated
  using (vendor_email = (select lower(auth.jwt() ->> 'email')) and (select public.cdf_my_role()) = 'vendor');

drop policy cdf_members_read on public.cdf_members;
create policy cdf_members_read on public.cdf_members for select to authenticated
  using ((select public.cdf_is_staff()) or email = (select lower(auth.jwt() ->> 'email')));

drop policy cdf_notifications_insert on public.cdf_notifications;
create policy cdf_notifications_insert on public.cdf_notifications for insert to authenticated
  with check (public.cdf_can_progress(order_id) and audience = 'customer' and channel <> 'email'
    and by_email = (select lower(auth.jwt() ->> 'email')));

-- 2) Team photos: every member can see the team's profile pictures (chat, mentions). Writing stays own-folder only.
drop policy cdf_avatars_read on storage.objects;
create policy cdf_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-avatars' and (select public.cdf_my_role()) is not null);

-- 3) Push notifications (installed app on iPhone and Android): one row per device that allowed notifications.
create table public.cdf_push_subs (
  endpoint text primary key check (endpoint ~ '^https://'),
  member_email text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index cdf_push_subs_member_idx on public.cdf_push_subs (member_email);
alter table public.cdf_push_subs enable row level security;
create policy cdf_push_subs_own on public.cdf_push_subs for all to authenticated
  using (member_email = (select lower(auth.jwt() ->> 'email')))
  with check (member_email = (select lower(auth.jwt() ->> 'email')) and (select public.cdf_my_role()) is not null);
revoke all on public.cdf_push_subs from public, anon;
grant select, insert, update, delete on public.cdf_push_subs to authenticated;

-- Who may be told about an order: the same rules as reading it (office all; florist her orders; driver the ones he can take).
create function public.cdf_member_sees(p_email text, p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cdf_orders o join public.cdf_members m on m.email = lower(p_email)
    where o.id = p_order and (
      m.role = 'admin'
      or (m.role = 'vendor' and o.vendor_email = m.email)
      or (m.role = 'carrier' and o.archived_at is null and o.status = 'Ready'
          and (o.carrier_email is null or o.carrier_email = m.email)
          and (o.delivery <> 'Delivered' or o.date >= (now() at time zone 'Asia/Manila')::date - 1))))
$$;
revoke all on function public.cdf_member_sees(text, uuid) from public, anon, authenticated;
grant execute on function public.cdf_member_sees(text, uuid) to service_role;

-- Calls the cdf-push function with the same shared secret as cdf-notify
create function public.cdf_push_hook(p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := p_body);
end $$;
revoke all on function public.cdf_push_hook(jsonb) from public, anon, authenticated;

-- A new chat message: the function decides who to tell (mentions; people on that order)
create function public.cdf_push_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.cdf_push_hook(jsonb_build_object('kind', 'message', 'id', new.id));
  return new;
end $$;
create trigger cdf_messages_push after insert on public.cdf_messages
  for each row execute function public.cdf_push_message();

-- An order handed to a florist or a driver (not when you assign it to yourself)
create function public.cdf_push_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if new.vendor_email is not null and new.vendor_email <> v_me
     and (tg_op = 'INSERT' or old.vendor_email is distinct from new.vendor_email) then
    perform public.cdf_push_hook(jsonb_build_object('kind', 'assigned', 'id', new.id, 'to', new.vendor_email));
  end if;
  if new.carrier_email is not null and new.carrier_email <> v_me
     and (tg_op = 'INSERT' or old.carrier_email is distinct from new.carrier_email) then
    perform public.cdf_push_hook(jsonb_build_object('kind', 'assigned', 'id', new.id, 'to', new.carrier_email));
  end if;
  return new;
end $$;
create trigger cdf_orders_push after insert or update of vendor_email, carrier_email on public.cdf_orders
  for each row execute function public.cdf_push_assigned();
