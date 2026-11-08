-- Each device that allowed notifications remembers the app language it was using, so cdf-push writes
-- "Nuevo pedido" or "New order" for that phone. Unknown (older rows) means English.
alter table public.cdf_push_subs
  add column lang text check (lang is null or lang in ('es', 'en'));
