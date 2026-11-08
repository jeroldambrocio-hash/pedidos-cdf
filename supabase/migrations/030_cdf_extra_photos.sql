-- Several extra photos per order ("More details" in the editor). Only adds a column; nothing else changes.
-- Files live in the private bucket cdf-entregas as <order id>/<random>.jpg, so the existing storage policies
-- already apply: admins manage them, and the florist working on the order can see them.
alter table public.cdf_orders add column extra_photos text[] not null default '{}';
