-- Preserve existing prices in a protected table. Keep the legacy column (always NULL)
-- for compatibility with open older clients; no column, table or order is deleted.
-- Backup schema is not exposed through the API; no customer/order data is deleted.
create schema if not exists cdf_backup_20261028_integration;
revoke all on schema cdf_backup_20261028_integration from public, anon, authenticated;
create table cdf_backup_20261028_integration.prices as select id, amount from public.cdf_orders;

create table public.cdf_order_prices (
 order_id uuid primary key references public.cdf_orders(id) on delete cascade,
 amount numeric(10,2) check(amount is null or amount>=0)
);
alter table public.cdf_order_prices enable row level security;
revoke all on public.cdf_order_prices from public,anon,authenticated;
grant select,insert,update on public.cdf_order_prices to authenticated;
grant all on public.cdf_order_prices to service_role;
create policy cdf_prices_admin on public.cdf_order_prices for all to authenticated
 using ((select public.cdf_is_admin())) with check ((select public.cdf_is_admin()));
insert into public.cdf_order_prices(order_id,amount) select id,amount from public.cdf_orders where amount is not null;
do $$begin
 if (select count(*) from public.cdf_orders where amount is not null) <> (select count(*) from public.cdf_order_prices) then
  raise exception 'price preservation check failed';
 end if;
end$$;
update public.cdf_orders set amount=null where amount is not null;
create function public.cdf_guard_legacy_price() returns trigger language plpgsql set search_path='' as $$
begin
 if new.amount is not null then raise exception 'Prices must be saved through the protected price table' using errcode='42501'; end if;
 return new;
end$$;
revoke all on function public.cdf_guard_legacy_price() from public,anon,authenticated;
create trigger cdf_legacy_price_guard before insert or update of amount on public.cdf_orders
 for each row execute function public.cdf_guard_legacy_price();

-- A dedicated event prevents price information leaking through shared order histories.
create policy cdf_events_prices_private on public.cdf_order_events as restrictive for select to authenticated
 using (not(changes ? 'amount') or (select public.cdf_is_admin()));
create function public.cdf_log_price() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or old.amount is distinct from new.amount then
  insert into public.cdf_order_events(order_id,by_email,kind,changes)
  values(new.order_id,lower(auth.jwt()->>'email'),'updated',jsonb_build_object('amount',jsonb_build_array(case when tg_op='UPDATE' then old.amount else null end,new.amount)));
 end if;
 return new;
end$$;
revoke all on function public.cdf_log_price() from public,anon,authenticated;
create trigger cdf_price_history after insert or update on public.cdf_order_prices for each row execute function public.cdf_log_price();
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cdf_order_prices') then
  alter publication supabase_realtime add table public.cdf_order_prices;
 end if;
end$$;

create function public.cdf_normalize(p_value text) returns text language sql immutable parallel safe set search_path='' as $$
 select translate(lower(coalesce(p_value,'')),'áàäâãåéèëêíìïîóòöôõúùüûñç','aaaaaaeeeeiiiiooooouuuunc')
$$;
revoke all on function public.cdf_normalize(text) from public,anon;
grant execute on function public.cdf_normalize(text) to authenticated;

-- Invoker functions retain the caller's row policies, including archived orders for office staff.
create function public.cdf_search_orders(p_query text) returns setof public.cdf_orders
language sql stable security invoker set search_path='' as $$
 select o.* from public.cdf_orders o
 where public.cdf_is_staff() and length(trim(p_query))>0 and (
  strpos(public.cdf_normalize(concat_ws(' ',o.num,o.customer_name,o.buyer_name,o.address,o.customer_email)),public.cdf_normalize(trim(p_query)))>0
  or (length(regexp_replace(p_query,'\D','','g'))>=3 and (
   strpos(regexp_replace(coalesce(o.customer_phone,''),'\D','','g'),right(regexp_replace(p_query,'\D','','g'),9))>0
   or strpos(regexp_replace(coalesce(o.buyer_phone,''),'\D','','g'),right(regexp_replace(p_query,'\D','','g'),9))>0)))
 order by o.date desc,o.id limit 201
$$;
revoke all on function public.cdf_search_orders(text) from public,anon;
grant execute on function public.cdf_search_orders(text) to authenticated;

create function public.cdf_buyer_history(p_phone text,p_exclude uuid default null) returns table(n bigint,total numeric)
language sql stable security invoker set search_path='' as $$
 select count(*),coalesce(sum(p.amount),0) from public.cdf_orders o left join public.cdf_order_prices p on p.order_id=o.id
 where public.cdf_is_staff() and length(regexp_replace(p_phone,'\D','','g'))>=9
 and (p_exclude is null or o.id<>p_exclude)
 and right(regexp_replace(coalesce(nullif(o.buyer_phone,''),o.customer_phone,''),'\D','','g'),9)=right(regexp_replace(p_phone,'\D','','g'),9)
$$;
revoke all on function public.cdf_buyer_history(text,uuid) from public,anon;
grant execute on function public.cdf_buyer_history(text,uuid) to authenticated;

create or replace function public.cdf_progress(p_id uuid, p_step text, p_note text default null, p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare
  r public.cdf_orders;
  v_role text := public.cdf_my_role();
  v_me text := lower(coalesce(auth.jwt()->>'email', ''));
  v_status text; v_delivery text;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.cdf_is_staff() and (r.archived_at is not null
    or (public.cdf_my_role()='carrier' and r.carrier_email is not null and r.carrier_email<>lower(coalesce(auth.jwt()->>'email','')))
    or (public.cdf_my_role()='vendor' and r.vendor_email is distinct from lower(coalesce(auth.jwt()->>'email','')))) then
    raise exception 'order is no longer assigned to this user' using errcode='42501';
  end if;
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
  if not public.cdf_is_staff() and not public.cdf_step_ok(public.cdf_step_of(r.status, r.delivery), p_step) then
    raise exception 'this step does not follow from the current one' using errcode = '22023';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = v_status, delivery = v_delivery,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end,
    carrier_email = case when v_role = 'carrier' and p_step in ('transit', 'done', 'fail') then coalesce(carrier_email, v_me) else carrier_email end
  where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.cdf_reschedule(p_id uuid, p_date date, p_slot text, p_note text default null,
  p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null or coalesce(p_slot, '') !~ '^\d{1,2}:\d{2} - \d{1,2}:\d{2}$' then
    raise exception 'bad date or slot' using errcode = '22023';
  end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.cdf_is_staff() and (r.archived_at is not null
    or (public.cdf_my_role()='carrier' and r.carrier_email is not null and r.carrier_email<>lower(coalesce(auth.jwt()->>'email','')))
    or (public.cdf_my_role()='vendor' and r.vendor_email is distinct from lower(coalesce(auth.jwt()->>'email','')))) then
    raise exception 'order is no longer assigned to this user' using errcode='42501';
  end if;
  if not public.cdf_is_staff() and public.cdf_step_of(r.status, r.delivery) not in ('transit', 'fail') then
    raise exception 'only an order out for delivery can be rescheduled' using errcode = '22023';
  end if;
  if not public.cdf_is_staff() and p_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'the new date is in the past' using errcode = '22023';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = 'Ready', delivery = '-',
    missed_on = date, missed_at = now(), attempts = attempts + 1,
    date = p_date, slot = p_slot,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end
  where id = p_id returning * into r;
  return r;
end $$;


