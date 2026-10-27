-- Four roles:
--   admin      everything, including the team
--   moderator  all orders like an admin (create, edit, assign), but no team management and no deleting orders
--   vendor     only their own orders; moves the status, writes the delivery note, uploads the proof photo
--   carrier    every order that is Ready; takes it In transit and marks it Delivered or Failed, with note and photo
-- Vendors and carriers never write cdf_orders directly: they go through cdf_progress(), which checks the step.
-- Moving an order to In transit emails the customer automatically (cdf-notify, action "auto_transit").

alter table public.cdf_members drop constraint cdf_members_role_check;
alter table public.cdf_members add constraint cdf_members_role_check
  check (role in ('admin', 'moderator', 'vendor', 'carrier'));

create function public.cdf_is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.cdf_my_role() in ('admin', 'moderator'), false)
$$;

-- Can the signed-in user move this order along?
create function public.cdf_can_progress(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.cdf_is_staff() or exists (
    select 1 from public.cdf_orders o
    where o.id = p_id and (
      (public.cdf_my_role() = 'vendor' and o.vendor_email = lower(coalesce(auth.jwt()->>'email', '')))
      or (public.cdf_my_role() = 'carrier' and o.status = 'Ready')))
$$;
-- Same, from a storage path "<order uuid>/<file>"
create function public.cdf_can_progress_path(p_name text) returns boolean language sql stable security definer set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.cdf_can_progress(split_part(p_name, '/', 1)::uuid) else false end
$$;
revoke all on function public.cdf_is_staff(), public.cdf_can_progress(uuid), public.cdf_can_progress_path(text) from public, anon;
grant execute on function public.cdf_is_staff(), public.cdf_can_progress(uuid), public.cdf_can_progress_path(text) to authenticated;

-- Members: staff can read the whole team (to assign vendors); only admins write it.
drop policy cdf_members_read on public.cdf_members;
create policy cdf_members_read on public.cdf_members for select to authenticated
  using (public.cdf_is_staff() or email = lower(auth.jwt()->>'email'));

-- Orders
drop policy cdf_orders_admin on public.cdf_orders;
create policy cdf_orders_staff_read on public.cdf_orders for select to authenticated using (public.cdf_is_staff());
create policy cdf_orders_staff_insert on public.cdf_orders for insert to authenticated with check (public.cdf_is_staff());
create policy cdf_orders_staff_update on public.cdf_orders for update to authenticated
  using (public.cdf_is_staff()) with check (public.cdf_is_staff());
create policy cdf_orders_admin_delete on public.cdf_orders for delete to authenticated using (public.cdf_is_admin());
create policy cdf_orders_carrier_read on public.cdf_orders for select to authenticated
  using (status = 'Ready' and public.cdf_my_role() = 'carrier');

-- Order photos: staff manage them; vendors (own orders) and carriers (Ready orders) can view.
drop policy cdf_fotos_admin on storage.objects;
create policy cdf_fotos_staff on storage.objects for all to authenticated
  using (bucket_id = 'cdf-fotos' and public.cdf_is_staff())
  with check (bucket_id = 'cdf-fotos' and public.cdf_is_staff());
create policy cdf_fotos_carrier_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-fotos' and public.cdf_my_role() = 'carrier' and exists (
    select 1 from public.cdf_orders o where o.photo_path = storage.objects.name and o.status = 'Ready'));

-- Proof photos: whoever can move the order can upload/replace them, inside that order's folder.
drop policy cdf_entregas_admin on storage.objects;
create policy cdf_entregas_staff on storage.objects for all to authenticated
  using (bucket_id = 'cdf-entregas' and public.cdf_is_staff())
  with check (bucket_id = 'cdf-entregas' and public.cdf_is_staff());
create policy cdf_entregas_progress_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cdf-entregas' and public.cdf_can_progress_path(name));
create policy cdf_entregas_progress_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cdf-entregas' and public.cdf_can_progress_path(name));
create policy cdf_entregas_progress_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-entregas' and public.cdf_can_progress_path(name));

-- Notification history: staff see all; vendors/carriers see and log the orders they work on.
drop policy cdf_notifications_admin_read on public.cdf_notifications;
drop policy cdf_notifications_admin_insert on public.cdf_notifications;
create policy cdf_notifications_read on public.cdf_notifications for select to authenticated
  using (public.cdf_can_progress(order_id));
create policy cdf_notifications_insert on public.cdf_notifications for insert to authenticated
  with check (public.cdf_can_progress(order_id) and audience = 'customer' and channel <> 'email'
    and by_email = lower(auth.jwt()->>'email'));

-- Status changes for vendors and carriers (staff may use it too).
create function public.cdf_progress(p_id uuid, p_step text, p_note text default null, p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare
  r public.cdf_orders;
  v_role text := public.cdf_my_role();
  v_status text; v_delivery text;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  case p_step
    when 'prep' then v_status := 'Preparing'; v_delivery := '-';
    when 'ready' then v_status := 'Ready'; v_delivery := '-';
    when 'transit' then v_status := 'Ready'; v_delivery := 'In transit';
    when 'done' then v_status := 'Ready'; v_delivery := 'Delivered';
    when 'fail' then v_status := 'Ready'; v_delivery := 'Failed';
    else raise exception 'bad step' using errcode = '22023';
  end case;
  if v_role = 'carrier' and p_step not in ('transit', 'done', 'fail') then
    raise exception 'carriers can only set In transit, Delivered or Failed' using errcode = '42501';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = v_status, delivery = v_delivery,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end
  where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.cdf_progress(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.cdf_progress(uuid, text, text, text, boolean) to authenticated;

-- Automatic customer email when an order goes In transit.
create function public.cdf_notify_transit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if new.delivery <> 'In transit' or old.delivery is not distinct from new.delivery then return new; end if;
  if coalesce(trim(new.customer_email), '') = '' then return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := jsonb_build_object('order_id', new.id, 'action', 'auto_transit')
  );
  return new;
end $$;
revoke all on function public.cdf_notify_transit() from public, anon, authenticated;
create trigger cdf_orders_transit after update of delivery on public.cdf_orders
  for each row execute function public.cdf_notify_transit();
