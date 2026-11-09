-- Which Lalamove vehicle an order needs (big arrangements go by car). Empty = motorcycle, the default.
-- Only adds a column; the booking step starts from it and can still be changed there.
alter table public.cdf_orders
  add column vehicle text,
  add constraint cdf_orders_vehicle check (vehicle is null or vehicle in ('MOTORCYCLE', 'SEDAN', 'MPV'));
