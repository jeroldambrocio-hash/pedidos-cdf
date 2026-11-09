-- 9/11/2026. Payments (down payment + proof of transfer) and Lalamove alerts. Only adds columns, a bucket,
-- policies and triggers; no existing data changes.

-- 1) Payments live next to the price, in the admin-only table (florists never see money)
alter table public.cdf_order_prices
  add column paid numeric(10,2) check (paid is null or paid >= 0),
  add column pay_proofs text[] not null default '{}' check (cardinality(pay_proofs) <= 12);
-- Orders with a payment but no price yet need a price row
alter table public.cdf_order_prices alter column amount drop not null;

-- The price history also records what was paid (still admin-only: the restrictive policy covers both keys)
create or replace function public.cdf_log_price() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb := '{}';
begin
 if tg_op='INSERT' or old.amount is distinct from new.amount then
  v := v || jsonb_build_object('amount', jsonb_build_array(case when tg_op='UPDATE' then old.amount else null end, new.amount));
 end if;
 if tg_op='INSERT' and new.paid is not null or tg_op='UPDATE' and old.paid is distinct from new.paid then
  v := v || jsonb_build_object('paid', jsonb_build_array(case when tg_op='UPDATE' then old.paid else null end, new.paid));
 end if;
 if v <> '{}' then
  insert into public.cdf_order_events(order_id,by_email,kind,changes) values(new.order_id,lower(auth.jwt()->>'email'),'updated',v);
 end if;
 return new;
end$$;
revoke all on function public.cdf_log_price() from public,anon,authenticated;
drop policy if exists cdf_events_prices_private on public.cdf_order_events;
create policy cdf_events_prices_private on public.cdf_order_events as restrictive for select to authenticated
 using (not (changes ?| array['amount','paid']) or (select public.cdf_is_admin()));

-- Proofs of payment: their own private bucket, admins only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-pagos', 'cdf-pagos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy cdf_pagos_admin on storage.objects for all to authenticated
 using (bucket_id = 'cdf-pagos' and (select public.cdf_is_admin()))
 with check (bucket_id = 'cdf-pagos' and (select public.cdf_is_admin()));

-- 2) Lalamove: tell a cancellation we asked for apart from one Lalamove or the rider made
alter table public.cdf_lalamove add column cancelled_by_us boolean not null default false;

-- Push: the florist when a rider is assigned and heading to her shop; the admins when the delivery
-- falls through on Lalamove's side (rider cancelled, nobody took it, expired)
create function public.cdf_push_rider() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_vendor text;
begin
  if new.status is not distinct from old.status or new.ll_order_id is null then return new; end if;
  if new.status = 'ON_GOING' then
    select vendor_email into v_vendor from public.cdf_orders where id = new.order_id and cancelled_at is null;
    if v_vendor is not null then
      perform public.cdf_push_hook(jsonb_build_object('kind', 'rider', 'id', new.order_id, 'to', v_vendor));
    end if;
  elsif new.status in ('CANCELED', 'REJECTED', 'EXPIRED') and not new.cancelled_by_us then
    perform public.cdf_push_hook(jsonb_build_object('kind', 'rider_failed', 'id', new.order_id, 'status', new.status));
  end if;
  return new;
end $$;
revoke all on function public.cdf_push_rider() from public, anon, authenticated;
create trigger cdf_lalamove_push after update of status on public.cdf_lalamove
  for each row execute function public.cdf_push_rider();
