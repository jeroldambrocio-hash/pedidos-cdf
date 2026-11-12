-- 12/11/2026. Statistics only for the admins chosen in Team.
-- One column on cdf_members: sees_stats (true for everyone today, so nothing changes until someone is
-- switched off). The panel shows the Statistics tab only to admins who have it.
-- Who may change it: only an admin who sees statistics, and never for themselves (nobody can switch
-- themselves on, and the one switching others off keeps it, so it can't be lost by accident).
-- Note: this hides the summary page. Each order's price is still visible to every admin in the order
-- itself, as today.
alter table public.cdf_members add column sees_stats boolean not null default true;

-- Reviewed 12/11/2026 (second review of PR #18):
--   · New admins and promotions to admin also count as giving Statistics. When the one doing it has no
--     Statistics, the new admin simply starts without them (the default true only stands for admins who have it).
--     The team function (cdf-users) adds people with the service identity, so it applies the same rule itself.
--   · There is always at least one admin with Statistics: switching off, demoting or removing the last one is
--     refused. Changes that give or take Statistics wait for each other (one lock), so two admins switching each
--     other off at the same moment can't both succeed.
create function public.cdf_guard_sees_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := lower(coalesce(auth.jwt()->>'email', ''));
  v_had boolean := false;   -- an admin with Statistics before
  v_has boolean := false;   -- an admin with Statistics after
  v_flag boolean := false;  -- the switch itself was changed
begin
  if tg_op <> 'INSERT' then v_had := coalesce(old.role = 'admin' and old.sees_stats, false); end if;
  if tg_op <> 'DELETE' then v_has := coalesce(new.role = 'admin' and new.sees_stats, false); end if;
  if tg_op = 'UPDATE' then v_flag := new.sees_stats is distinct from old.sees_stats; end if;
  if v_had = v_has and not v_flag then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- One change of who sees Statistics at a time (read committed: each query below sees what the other committed)
  perform pg_advisory_xact_lock(hashtext('public.cdf_members.sees_stats'));

  -- Someone signed in: only an admin with Statistics decides who has them, and never for themselves.
  -- The database itself (migrations, the service role) is not limited here.
  if auth.uid() is not null then
    if v_flag and v_actor = lower(old.email) then raise exception 'cdf_stats_own' using errcode = '42501'; end if;
    if not exists (select 1 from public.cdf_members m where m.email = v_actor and m.role = 'admin' and m.sees_stats) then
      if v_has and not v_flag then
        new.sees_stats := false; v_has := false;   -- new or promoted admin: starts without Statistics
      elsif v_had <> v_has or v_flag then
        raise exception 'cdf_stats_forbidden' using errcode = '42501';
      end if;
    end if;
  end if;

  if v_had and not v_has and not exists (
    select 1 from public.cdf_members m where m.role = 'admin' and m.sees_stats and m.email <> old.email) then
    raise exception 'cdf_stats_last' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger cdf_members_sees_stats before insert or delete or update of role, sees_stats on public.cdf_members
  for each row execute function public.cdf_guard_sees_stats();
revoke all on function public.cdf_guard_sees_stats() from public, anon, authenticated;
