-- The customer's exact delivery point, pasted once when the order is made (a Google Maps link), so booking
-- a Lalamove rider goes straight to the price. Optional; only adds columns to cdf_orders.
alter table public.cdf_orders
  add column drop_lat numeric(9,6),
  add column drop_lng numeric(9,6),
  add constraint cdf_orders_drop_point check ((drop_lat is null) = (drop_lng is null));
