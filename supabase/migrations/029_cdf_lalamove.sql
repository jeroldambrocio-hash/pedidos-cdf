-- Lalamove deliveries (sandbox first). One row per order sent, or about to be sent, with Lalamove.
-- Only adds a table: no existing table, column, policy or order changes.
-- Only admins can read it; every write goes through the cdf-lalamove edge function (service role),
-- which holds the Lalamove keys. Nothing here is visible to florists, drivers or the public tracking page.
create table public.cdf_lalamove (
  order_id uuid primary key references public.cdf_orders(id) on delete cascade,
  env text not null default 'sandbox' check (env in ('sandbox', 'production')),
  -- Drop-off point confirmed by the admin (Lalamove needs coordinates, the order only has text)
  lat numeric(9,6), lng numeric(9,6), place text,
  service text not null default 'MOTORCYCLE',
  -- Last quotation (valid for a few minutes)
  quotation_id text, sender_stop text, recipient_stop text,
  quote_total numeric(10,2), quote_currency text, quote_expires timestamptz,
  -- The booked delivery
  ll_order_id text unique, status text, share_link text, price_total numeric(10,2),
  driver_id text, driver_name text, driver_phone text, driver_plate text, driver_photo text,
  booked_at timestamptz, error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger cdf_lalamove_touch before update on public.cdf_lalamove for each row execute function public.cdf_touch();

alter table public.cdf_lalamove enable row level security;
revoke all on public.cdf_lalamove from anon, authenticated;
grant select on public.cdf_lalamove to authenticated;
create policy cdf_lalamove_admin_read on public.cdf_lalamove for select to authenticated using (public.cdf_is_admin());

-- The panel updates live when the rider is assigned or the status changes
alter publication supabase_realtime add table public.cdf_lalamove;
