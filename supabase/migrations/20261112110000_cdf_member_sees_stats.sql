-- 12/11/2026. Statistics only for the admins chosen in Team.
-- One column on cdf_members: sees_stats (true for everyone today, so nothing changes until someone is
-- switched off). The panel shows the Statistics tab only to admins who have it.
-- Who may change it: only an admin who sees statistics, and never for themselves (nobody can switch
-- themselves on, and the one switching others off keeps it, so it can't be lost by accident).
-- Note: this hides the summary page. Each order's price is still visible to every admin in the order
-- itself, as today.
alter table public.cdf_members add column sees_stats boolean not null default true;

create function public.cdf_guard_sees_stats() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if new.sees_stats is not distinct from old.sees_stats then return new; end if;
  -- The database itself (migrations, the service role) is not limited
  if auth.uid() is null then return new; end if;
  if v_actor = lower(old.email) then raise exception 'cdf_stats_own' using errcode = '42501'; end if;
  if not exists (select 1 from public.cdf_members m where m.email = v_actor and m.role = 'admin' and m.sees_stats) then
    raise exception 'cdf_stats_forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger cdf_members_sees_stats before update of sees_stats on public.cdf_members
  for each row execute function public.cdf_guard_sees_stats();
revoke all on function public.cdf_guard_sees_stats() from public, anon, authenticated;
