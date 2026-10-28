-- 014 · Importe del pedido (precios). Opcional: el panel funciona igual sin esta columna.
-- Solo el admin lo ve y lo edita, y solo cuando activa "Precios" en su menú de cuenta.
alter table public.cdf_orders add column if not exists amount numeric(10,2);
alter table public.cdf_orders drop constraint if exists cdf_orders_amount_ok;
alter table public.cdf_orders add constraint cdf_orders_amount_ok check (amount is null or amount >= 0);
