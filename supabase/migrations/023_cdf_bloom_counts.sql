-- My Bloom Journey: what makes a person's plant grow, counted only by the database.
--
-- Anti-cheat rules (the count is derived from the orders' current state, never a +1 counter):
--   * Each order counts at most once per person (count distinct order id): moving a step back and forth gains nothing.
--   * Moving an order back un-credits it on its own: cdf_credit_order clears prepared_by when an order leaves Ready
--     and delivered_by when it leaves Delivered, so the total goes down.
--   * Credits cannot be written by hand: cdf_credit_order overwrites prepared_by / delivered_by on every insert/update.
--   * Florists and drivers only move their own orders, along cdf_step_ok; a driver cannot undo Delivered.
--   * Florist (arranged_total): orders she prepared that were really delivered to the customer. If she marked the
--     delivery herself, it needs the delivery photo (otherwise anyone could mark their own orders delivered).
--   * Driver (delivered_total): orders he delivered, with the delivery photo as evidence.
-- Archived orders still count (they are history); deleted orders do not.

drop function public.cdf_member_stats();
create function public.cdf_member_stats()
returns table (email text, done_total bigint, done_month bigint, done_week bigint, open_now bigint, arranged_total bigint, delivered_total bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select public.cdf_my_role() as role, lower(coalesce(auth.jwt() ->> 'email', '')) as email),
       today as (select (now() at time zone 'Asia/Manila')::date as d)
  select m.email,
    count(distinct o.id) filter (where o.delivery = 'Delivered'),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date >= date_trunc('month', (select d from today))::date and o.date <= (select d from today)),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date > (select d from today) - 7 and o.date <= (select d from today)),
    (select count(*) from public.cdf_orders p where p.archived_at is null and p.delivery is distinct from 'Delivered'
      and (p.vendor_email = m.email or p.carrier_email = m.email)),
    count(distinct o.id) filter (where o.prepared_by = m.email and o.delivery = 'Delivered'
      and (o.delivered_by is distinct from m.email or o.proof_path is not null)),
    count(distinct o.id) filter (where o.delivered_by = m.email and o.delivery = 'Delivered' and o.proof_path is not null)
  from public.cdf_members m cross join me
  left join public.cdf_orders o on (o.prepared_by = m.email or o.delivered_by = m.email)
  where me.role = 'admin' or m.email = me.email
  group by m.email
$$;
revoke all on function public.cdf_member_stats() from public, anon;
grant execute on function public.cdf_member_stats() to authenticated;
