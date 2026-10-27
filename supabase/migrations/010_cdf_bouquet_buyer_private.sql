-- 1) The bouquet photo, taken by the florist before it leaves, is its own field: the customer sees it.
--    photo_path stays the internal screenshot of the order and is never shown to the customer.
-- 2) Delivery and bouquet photos are private. The tracking page gets short-lived links from cdf-track.
-- 3) Buyer vs recipient: customer_name / customer_phone / address are the recipient (the driver calls them);
--    buyer_name / buyer_phone and customer_email are who bought and gets the notices. Plus the card message.
alter table public.cdf_orders
  add column bouquet_path text,
  add column buyer_name text not null default '',
  add column buyer_phone text not null default '',
  add column card_message text not null default '';

update storage.buckets set public = false where id = 'cdf-entregas';

-- Florists (own orders) and drivers set the bouquet photo; the file must sit in the order's folder.
create function public.cdf_set_bouquet(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p_id::text then
    raise exception 'bad path' using errcode = '22023';
  end if;
  update public.cdf_orders set bouquet_path = p_path where id = p_id;
end $$;
revoke all on function public.cdf_set_bouquet(uuid, text) from public, anon;
grant execute on function public.cdf_set_bouquet(uuid, text) to authenticated;
