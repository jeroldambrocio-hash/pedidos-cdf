-- 11/11/2026. Phase 4: which shop is nearest to a delivery point, as a suggestion for the admin.
-- Additive only: one function. It reads the florists' shop data already in cdf_members (branch, pickup point,
-- absences); nothing is stored and nobody is assigned. The distance is a straight line (Haversine), not a
-- driving time: the panel says so. Shops are grouped only when several florists share both the same point
-- and the same branch name; anything that does not agree is listed as a conflict to correct in Team.

create function public.cdf_branch_ranking(p_lat numeric, p_lng numeric, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ranked jsonb;
  v_incomplete jsonb;
  v_conflicts jsonb;
begin
  if auth.uid() is null or not coalesce(public.cdf_is_admin(), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or not (p_lat between 4 and 21.5 and p_lng between 116 and 127) then
    raise exception 'cdf_invalid_point';
  end if;

  with florists as (
    select m.email, m.name, nullif(btrim(m.branch), '') as branch, nullif(btrim(m.pickup_address), '') as address,
      m.pickup_lat as lat, m.pickup_lng as lng,
      (p_date is not null and m.away_from is not null and p_date >= m.away_from and (m.away_until is null or p_date <= m.away_until)) as away,
      m.away_until
    from public.cdf_members m
    where m.role = 'vendor'
  ),
  usable as (
    -- In the ranking only with a point inside the Philippines and a branch name
    select f.*, round(f.lat, 5) as plat, round(f.lng, 5) as plng
    from florists f
    where f.lat is not null and f.branch is not null and f.lat between 4 and 21.5 and f.lng between 116 and 127
  ),
  shops as (
    -- One preparation point: same place (to about a metre) and same name
    select u.branch, u.plat, u.plng, min(u.address) as address,
      jsonb_agg(jsonb_build_object('email', u.email, 'name', u.name, 'away', u.away, 'away_until', u.away_until) order by u.away, u.name) as florists,
      bool_and(u.away) as all_away,
      round((6371 * 2 * asin(sqrt(
        power(sin(radians(u.plat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(u.plat)) * power(sin(radians(u.plng - p_lng) / 2), 2))))::numeric, 2) as km
    from usable u
    group by u.branch, u.plat, u.plng
  )
  select coalesce(jsonb_agg(jsonb_build_object('branch', s.branch, 'address', s.address, 'lat', s.plat, 'lng', s.plng, 'km', s.km,
      'florists', s.florists, 'all_away', s.all_away) order by s.all_away, s.km, s.branch), '[]'::jsonb)
  into v_ranked from shops s;

  -- Florists left out, and why: no shop point, no branch name, or a point outside the Philippines
  select coalesce(jsonb_agg(jsonb_build_object('email', f.email, 'name', f.name, 'missing',
      array_remove(array[
        case when f.lat is null then 'point' end,
        case when f.lat is not null and not (f.lat between 4 and 21.5 and f.lng between 116 and 127) then 'point_outside' end,
        case when f.branch is null then 'branch' end], null)) order by f.name), '[]'::jsonb)
  into v_incomplete
  from public.cdf_members m
  join lateral (select m.email, m.name, nullif(btrim(m.branch), '') as branch, m.pickup_lat as lat, m.pickup_lng as lng) f on true
  where m.role = 'vendor' and (f.lat is null or f.branch is null or not (f.lat between 4 and 21.5 and f.lng between 116 and 127));

  -- Data that disagrees: one branch name at several points, or one point under several names
  select coalesce(jsonb_agg(c order by c->>'kind', c->>'label'), '[]'::jsonb) into v_conflicts from (
    select jsonb_build_object('kind', 'name_many_points', 'label', min(m.branch),
        'florists', jsonb_agg(m.name order by m.name)) as c
    from public.cdf_members m
    where m.role = 'vendor' and nullif(btrim(m.branch), '') is not null and m.pickup_lat is not null
    group by lower(btrim(m.branch))
    having count(distinct (round(m.pickup_lat, 5), round(m.pickup_lng, 5))) > 1
    union all
    select jsonb_build_object('kind', 'point_many_names', 'label', string_agg(distinct btrim(m.branch), ' / '),
        'florists', jsonb_agg(m.name order by m.name))
    from public.cdf_members m
    where m.role = 'vendor' and nullif(btrim(m.branch), '') is not null and m.pickup_lat is not null
    group by round(m.pickup_lat, 5), round(m.pickup_lng, 5)
    having count(distinct lower(btrim(m.branch))) > 1
  ) x;

  return jsonb_build_object('ranked', v_ranked, 'incomplete', v_incomplete, 'conflicts', v_conflicts);
end $$;

revoke all on function public.cdf_branch_ranking(numeric, numeric, date) from public, anon;
grant execute on function public.cdf_branch_ranking(numeric, numeric, date) to authenticated;
