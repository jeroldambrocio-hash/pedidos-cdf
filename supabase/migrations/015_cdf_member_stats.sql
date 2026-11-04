-- Completed orders per florist (delivered, archived ones included), counted on the delivery date in Manila.
-- Admins and moderators get every florist; a florist only gets their own row.
create function public.cdf_member_stats()
returns table(email text, done_total bigint, done_month bigint, done_week bigint, open_now bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select public.cdf_my_role() as role, lower(coalesce(auth.jwt()->>'email', '')) as email),
       today as (select (now() at time zone 'Asia/Manila')::date as d)
  select o.vendor_email,
    count(*) filter (where o.delivery = 'Delivered'),
    count(*) filter (where o.delivery = 'Delivered' and o.date >= date_trunc('month', (select d from today))::date and o.date <= (select d from today)),
    count(*) filter (where o.delivery = 'Delivered' and o.date > (select d from today) - 7 and o.date <= (select d from today)),
    count(*) filter (where o.delivery is distinct from 'Delivered' and o.archived_at is null)
  from public.cdf_orders o, me
  where o.vendor_email is not null
    and (me.role in ('admin', 'moderator') or (me.role = 'vendor' and o.vendor_email = me.email))
  group by o.vendor_email
$$;
revoke all on function public.cdf_member_stats() from public, anon;
grant execute on function public.cdf_member_stats() to authenticated;
