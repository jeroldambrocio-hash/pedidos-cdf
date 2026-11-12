-- 12/11/2026. Review fix for Phase 5's read-back of finished deliveries (cdf_ll_reconcile_due).
-- Before: a completed delivery stopped being read back as soon as it had ANY delivery-proof row, even one
-- saying "not provided" (Lalamove marked it delivered with no photo yet). A photo Lalamove added later was
-- then only picked up if another webhook happened to arrive. Also, "finished in the last 2 days" was
-- measured on updated_at, which every check itself moves forward, so the window never closed.
-- Now: a completed delivery is read back every 30 minutes, for 3 days after it was booked, while it has no
-- kept proof (available, or removed by the office) and Lalamove has not said the delivery failed.
-- Running deliveries are unchanged (every 4 minutes, 3 days). Same signature; nothing else changes.
create or replace function public.cdf_ll_reconcile_due(p_limit integer) returns setof text
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_shipments s set last_checked_at = now()
  where s.ll_order_id in (
    select s2.ll_order_id from public.cdf_lalamove_shipments s2
    join public.cdf_lalamove l on l.ll_order_id = s2.ll_order_id
    where coalesce(s2.booked_at, s2.created_at) > now() - interval '3 days'
      and (
        (coalesce(s2.status, '') not in ('COMPLETED', 'CANCELED', 'REJECTED', 'EXPIRED')
          and (s2.last_checked_at is null or s2.last_checked_at < now() - interval '4 minutes'))
        or (s2.status = 'COMPLETED'
          and (s2.last_checked_at is null or s2.last_checked_at < now() - interval '30 minutes')
          and not exists (select 1 from public.cdf_lalamove_proofs p
            where p.ll_order_id = s2.ll_order_id and p.kind = 'pod'
              and (p.state in ('available', 'removed') or p.provider_status = 'FAILED'))))
    order by s2.last_checked_at nulls first
    limit greatest(1, least(coalesce(p_limit, 10), 30))
    for update of s2 skip locked)
  returning s.ll_order_id
$$;
revoke all on function public.cdf_ll_reconcile_due(integer) from public, anon, authenticated;
grant execute on function public.cdf_ll_reconcile_due(integer) to service_role;
