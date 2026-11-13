-- Audit 13/11/2026: four counts that could be wrong.
--  1. Statistics: an order that was delivered could be moved back a step and then cancelled, and so dropped out
--     of the statistics (they leave out cancelled orders). Once delivered (fulfilled_at), it cannot be cancelled.
--  2. Profiles: "open now" counted orders in the trash as still pending.
--  3. Buyer history: cancelled orders and orders in the trash were added in with the real ones. Now only the
--     valid ones count, and how many were cancelled is said apart.
--  4. Search: up to 201 results, newest first, trash included; the panel then hides the trash, so many trashed
--     matches could push active orders out. The trash is left out here (it has its own view).

-- 1 ---------------------------------------------------------------------------------------------------------
create or replace function public.cdf_keep_successful_order() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.fulfilled_at is not null or old.delivery = 'Delivered'
    or (tg_op = 'UPDATE' and (new.fulfilled_at is not null or new.delivery = 'Delivered')) then
    if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
      raise exception 'cdf_successful_order_retained' using errcode = '42501',
        hint = 'Archive this order instead. Successful orders stay in statistics.';
    end if;
    if tg_op = 'UPDATE' and old.cancelled_at is null and new.cancelled_at is not null then
      raise exception 'cdf_delivered_not_cancellable' using errcode = '42501',
        hint = 'This order was delivered: it stays in statistics and cannot be cancelled.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.cdf_keep_successful_order() from public, anon, authenticated;

-- 2 ---------------------------------------------------------------------------------------------------------
create or replace function public.cdf_member_stats()
 returns table(email text, done_total bigint, done_month bigint, done_week bigint, open_now bigint, arranged_total bigint, delivered_total bigint)
 language sql stable security definer set search_path to ''
as $function$
  with me as (select public.cdf_my_role() as role, lower(coalesce(auth.jwt() ->> 'email', '')) as email),
       today as (select (now() at time zone 'Asia/Manila')::date as d)
  select m.email,
    count(distinct o.id) filter (where o.delivery = 'Delivered'),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date >= date_trunc('month', (select d from today))::date and o.date <= (select d from today)),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date > (select d from today) - 7 and o.date <= (select d from today)),
    (select count(*) from public.cdf_orders p where p.archived_at is null and p.cancelled_at is null and p.deleted_at is null
      and p.delivery is distinct from 'Delivered'
      and (p.vendor_email = m.email or p.carrier_email = m.email)),
    count(distinct o.id) filter (where o.prepared_by = m.email and o.delivery = 'Delivered'
      and (o.delivered_by is distinct from m.email or o.proof_path is not null)),
    count(distinct o.id) filter (where o.delivered_by = m.email and o.delivery = 'Delivered' and o.proof_path is not null)
  from public.cdf_members m cross join me
  left join public.cdf_orders o on (o.prepared_by = m.email or o.delivered_by = m.email)
  where me.role = 'admin' or m.email = me.email
  group by m.email
$function$;

-- 3 ---------------------------------------------------------------------------------------------------------
-- The result gains a column, so the function is created again (the panel reads n, total and, now, cancelled).
drop function if exists public.cdf_buyer_history(text, uuid);
create function public.cdf_buyer_history(p_phone text, p_exclude uuid default null)
 returns table(n bigint, total numeric, cancelled bigint)
 language sql stable set search_path to ''
as $function$
 select count(*) filter (where o.cancelled_at is null),
   coalesce(sum(p.amount) filter (where o.cancelled_at is null), 0),
   count(*) filter (where o.cancelled_at is not null)
 from public.cdf_orders o left join public.cdf_order_prices p on p.order_id = o.id
 where public.cdf_is_staff() and length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
   and o.deleted_at is null
   and (p_exclude is null or o.id <> p_exclude)
   and right(regexp_replace(coalesce(nullif(o.buyer_phone, ''), o.customer_phone, ''), '\D', '', 'g'), 9) = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
$function$;
revoke all on function public.cdf_buyer_history(text, uuid) from public, anon;
grant execute on function public.cdf_buyer_history(text, uuid) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------------------
create or replace function public.cdf_search_orders(p_query text)
 returns setof public.cdf_orders
 language sql stable set search_path to ''
as $function$
 select o.* from public.cdf_orders o
 where public.cdf_is_staff() and length(trim(p_query)) > 0 and o.deleted_at is null and (
  strpos(public.cdf_normalize(concat_ws(' ', o.num, o.customer_name, o.buyer_name, o.address, o.customer_email)), public.cdf_normalize(trim(p_query))) > 0
  or (length(regexp_replace(p_query, '\D', '', 'g')) >= 3 and (
   strpos(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g'), right(regexp_replace(p_query, '\D', '', 'g'), 9)) > 0
   or strpos(regexp_replace(coalesce(o.buyer_phone, ''), '\D', '', 'g'), right(regexp_replace(p_query, '\D', '', 'g'), 9)) > 0)))
 order by o.date desc, o.id limit 201
$function$;
