-- Three roles only: admin, vendor (florist) and carrier (driver). The moderator role is gone:
-- nobody had it, the panel no longer offers it, and the office is the admin.

alter table public.cdf_members drop constraint if exists cdf_members_role_check;
alter table public.cdf_members add constraint cdf_members_role_check
  check (role in ('admin', 'vendor', 'carrier'));

create or replace function public.cdf_is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.cdf_my_role() = 'admin', false)
$$;

-- Completed orders: the admin gets everyone; each person only their own row.
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
  where me.role = 'admin' or m.email = me.email
  group by m.email
$$;
