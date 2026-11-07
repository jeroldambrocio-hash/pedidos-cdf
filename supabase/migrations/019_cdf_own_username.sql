-- The username column itself. On a fresh install it has to exist before 020 (chat directory)
-- reads it; 20261104120449_cdf_username_login.sql repeats this idempotently for databases
-- that applied that file first (the live one), so both orders end in the same schema.
alter table public.cdf_members add column if not exists username text;
do $$ begin
  alter table public.cdf_members add constraint cdf_username_format
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
exception when duplicate_object then null; end $$;
create unique index if not exists cdf_members_username_unique on public.cdf_members(username) where username is not null;

-- Each member may set or clear their own sign-in username from "My account".
-- Admins still edit anyone's from Team. Format and uniqueness stay enforced by
-- cdf_username_format and cdf_members_username_unique (unique_violation → 23505).
create function public.cdf_set_my_username(p_username text)
returns public.cdf_members language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email', '')); v_name text := nullif(lower(trim(coalesce(p_username, ''))), ''); r public.cdf_members;
begin
  if public.cdf_my_role() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_name is not null and v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'bad username' using errcode = '22023';
  end if;
  update public.cdf_members set username = v_name where email = v_email returning * into r;
  if r.email is null then raise exception 'no such member' using errcode = '22023'; end if;
  return r;
end $$;

revoke all on function public.cdf_set_my_username(text) from public, anon;
grant execute on function public.cdf_set_my_username(text) to authenticated;
