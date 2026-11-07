begin;

create table public.cdf_direct_threads (
  id uuid primary key default gen_random_uuid(),
  member_a text not null references public.cdf_members(email) on delete cascade,
  member_b text not null references public.cdf_members(email) on delete cascade,
  unique (member_a, member_b),
  check (member_a collate "C" < member_b collate "C")
);
create index cdf_direct_threads_member_b_idx on public.cdf_direct_threads (member_b);
alter table public.cdf_direct_threads enable row level security;
revoke all on public.cdf_direct_threads from public, anon, authenticated;
grant select on public.cdf_direct_threads to authenticated;
grant insert (member_a, member_b) on public.cdf_direct_threads to authenticated;
create policy cdf_direct_threads_read on public.cdf_direct_threads for select to authenticated
  using ((select public.cdf_my_role()) is not null
    and (select lower(auth.jwt() ->> 'email')) in (member_a, member_b));
create policy cdf_direct_threads_insert on public.cdf_direct_threads for insert to authenticated
  with check ((select public.cdf_my_role()) is not null
    and (select lower(auth.jwt() ->> 'email')) in (member_a, member_b));

-- The caller can create only a conversation in which they participate.
create function public.cdf_open_direct(peer text)
returns public.cdf_direct_threads
language plpgsql security invoker set search_path = '' as $$
declare
  me text := lower(auth.jwt() ->> 'email');
  a text;
  b text;
  result public.cdf_direct_threads;
begin
  peer := lower(btrim(peer));
  if me is null or peer is null or peer = me or public.cdf_my_role() is null then
    raise exception 'Invalid direct conversation' using errcode = '42501';
  end if;
  a := least(me collate "C", peer collate "C");
  b := greatest(me collate "C", peer collate "C");
  insert into public.cdf_direct_threads (member_a, member_b)
    values (a, b) on conflict (member_a, member_b) do nothing;
  select * into strict result from public.cdf_direct_threads
    where member_a = a and member_b = b;
  return result;
end;
$$;
revoke all on function public.cdf_open_direct(text) from public, anon;
grant execute on function public.cdf_open_direct(text) to authenticated;

-- Separate storage keeps private messages out of older clients and the team push pipeline.
create table public.cdf_direct_messages (
  id uuid primary key default gen_random_uuid(),
  direct_id uuid not null references public.cdf_direct_threads(id) on delete cascade,
  author_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index cdf_direct_messages_thread_idx on public.cdf_direct_messages (direct_id, created_at);
create index cdf_direct_messages_created_idx on public.cdf_direct_messages (created_at);
alter table public.cdf_direct_messages enable row level security;
revoke all on public.cdf_direct_messages from public, anon, authenticated;
grant select, insert (direct_id, author_email, body) on public.cdf_direct_messages to authenticated;

-- The thread's policy permits only its two current members, including for realtime reads.
create policy cdf_direct_messages_read on public.cdf_direct_messages for select to authenticated
  using (exists (select 1 from public.cdf_direct_threads d where d.id = direct_id));
create policy cdf_direct_messages_insert on public.cdf_direct_messages for insert to authenticated
  with check (author_email = (select lower(auth.jwt() ->> 'email'))
    and exists (select 1 from public.cdf_direct_threads d where d.id = direct_id));

alter publication supabase_realtime add table public.cdf_direct_threads, public.cdf_direct_messages;
commit;
