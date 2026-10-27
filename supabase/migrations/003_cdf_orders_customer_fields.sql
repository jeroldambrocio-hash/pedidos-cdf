alter table public.cdf_orders
  add column customer_name text not null default '',
  add column address text not null default '';
