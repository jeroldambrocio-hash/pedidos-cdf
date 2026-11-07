-- Optional, admin-managed usernames. Existing accounts keep their email/password.
-- Idempotent: on a fresh install 019 already created these (020 needs the column first).
alter table public.cdf_members add column if not exists username text;
do $$ begin
  alter table public.cdf_members add constraint cdf_username_format
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
exception when duplicate_object then null; end $$;
create unique index if not exists cdf_members_username_unique on public.cdf_members(username) where username is not null;

-- No anonymous email lookup. Only the login function's service role consumes quotas.
create table public.cdf_login_attempts (
  key text primary key, window_start timestamptz not null default now(), attempts integer not null default 1
);
alter table public.cdf_login_attempts enable row level security;
revoke all on public.cdf_login_attempts from public, anon, authenticated;
grant all on public.cdf_login_attempts to service_role;
create function public.cdf_login_attempt(p_key text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_key !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from public.cdf_login_attempts where window_start < now() - interval '1 day';
  insert into public.cdf_login_attempts as a(key) values(p_key)
  on conflict (key) do update set
    attempts = case when a.window_start < now() - interval '5 minutes' then 1 else a.attempts + 1 end,
    window_start = case when a.window_start < now() - interval '5 minutes' then now() else a.window_start end
  returning attempts into n;
  return n <= 10;
end;
$$;
revoke all on function public.cdf_login_attempt(text) from public, anon, authenticated;
grant execute on function public.cdf_login_attempt(text) to service_role;
