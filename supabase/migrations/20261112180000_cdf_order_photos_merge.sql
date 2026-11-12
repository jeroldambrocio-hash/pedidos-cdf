-- 12/11/2026. Audit F12: two people adding photos to the same order at once lost one of them, because each
-- editor wrote back the whole list as it was when it opened. Now the editor sends only what it added and
-- what it removed, and the database applies that to the list as it is at that moment, in one statement.
-- Additive: one function. It runs with the caller's own rights (the same row policies as editing the order).
create function public.cdf_order_photos_merge(p_id uuid, p_add text[], p_remove text[]) returns public.cdf_orders
language plpgsql set search_path = '' as $$
declare r public.cdf_orders;
begin
  if exists (select 1 from unnest(coalesce(p_add, '{}')) x where x is null or split_part(x, '/', 1) <> p_id::text) then
    raise exception 'cdf_photo_path' using errcode = '22023';
  end if;
  update public.cdf_orders o set extra_photos = (
    select coalesce(array_agg(x.path order by x.n), '{}') from (
      select path, min(n) as n from (
        select path, n from unnest(o.extra_photos) with ordinality as cur(path, n)
        union all
        select path, 1000 + n from unnest(coalesce(p_add, '{}')) with ordinality as nw(path, n)
      ) u where path <> all (coalesce(p_remove, '{}')) group by path
    ) x)
  where o.id = p_id returning * into r;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if cardinality(r.extra_photos) > 12 then raise exception 'cdf_photo_limit' using errcode = '22023'; end if;
  return r;
end $$;
revoke all on function public.cdf_order_photos_merge(uuid, text[], text[]) from public, anon;
grant execute on function public.cdf_order_photos_merge(uuid, text[], text[]) to authenticated;
