-- Which Casa de Flores branch each person belongs to, shown on their profile and in Team.
-- Only adds a column; the admin sets it in Team → edit (same rules as the other member fields).
alter table public.cdf_members
  add column branch text,
  add constraint cdf_members_branch_len check (branch is null or char_length(branch) between 1 and 60);

-- The three shops already set up, named after where they are
update public.cdf_members set branch = 'Parañaque' where branch is null and pickup_address ilike '%Parañaque%';
update public.cdf_members set branch = 'Quezon City' where branch is null and pickup_address ilike '%Quezon City%';
update public.cdf_members set branch = 'Pasig' where branch is null and pickup_address ilike '%Pasig%';
