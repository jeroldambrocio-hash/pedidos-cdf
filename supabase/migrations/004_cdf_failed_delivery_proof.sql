-- Failed delivery attempts, proof photo and note the customer can see, customer contact for notifications.
alter table public.cdf_orders drop constraint cdf_orders_delivery_check;
alter table public.cdf_orders add constraint cdf_orders_delivery_check
  check (delivery in ('-','In transit','Delivered','Failed'));
alter table public.cdf_orders
  add column delivery_note text not null default '',
  add column proof_path text,
  add column customer_phone text not null default '',
  add column customer_email text not null default '';

-- Proof photos are shown on the public tracking page, so this bucket is public;
-- paths are <order uuid>/<random>.jpg and anon has no list policy, so they can't be enumerated.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-entregas','cdf-entregas', true, 3145728, array['image/jpeg','image/png','image/webp']);
create policy cdf_entregas_admin on storage.objects for all to authenticated
  using (bucket_id = 'cdf-entregas' and public.cdf_is_admin())
  with check (bucket_id = 'cdf-entregas' and public.cdf_is_admin());

drop function public.cdf_track(text);
create function public.cdf_track(p_code text)
returns table(num text, date date, slot text, status text, delivery text, updated_at timestamptz, delivery_note text, proof_path text)
language sql stable security definer set search_path = '' as $$
  select o.num, o.date, o.slot, o.status, o.delivery, o.updated_at, o.delivery_note, o.proof_path
  from public.cdf_orders o where o.code = p_code and length(p_code) >= 8
$$;
revoke all on function public.cdf_track(text) from public;
grant execute on function public.cdf_track(text) to anon, authenticated;
