-- Where Lalamove picks up for each florist (each florist works from her own shop).
-- Only adds columns to cdf_members; the admin fills them in Team → edit. Shop addresses are not private:
-- the team can already see who is who, and the rider needs them anyway.
alter table public.cdf_members
  add column pickup_address text,
  add column pickup_lat numeric(9,6),
  add column pickup_lng numeric(9,6),
  add constraint cdf_members_pickup_point check ((pickup_lat is null) = (pickup_lng is null));
