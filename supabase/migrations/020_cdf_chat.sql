-- Team chat: a conversation per order and a #team channel (order_id null).
-- Who sees an order's messages is decided by the order's own row-level security: the policy only asks
-- "can you see this order?", so florists see their orders' threads, drivers the ones they deliver, the office all.

create table public.cdf_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.cdf_orders(id) on delete cascade,
  author_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index cdf_messages_order_idx on public.cdf_messages (order_id, created_at);
create index cdf_messages_created_idx on public.cdf_messages (created_at);
alter table public.cdf_messages enable row level security;

create policy cdf_messages_read on public.cdf_messages for select to authenticated
  using ((select public.cdf_my_role()) is not null
    and (order_id is null or exists (select 1 from public.cdf_orders o where o.id = order_id)));
-- Only as yourself, in #team or in an order you can see. No edits or deletes for now.
create policy cdf_messages_insert on public.cdf_messages for insert to authenticated
  with check ((select public.cdf_my_role()) is not null
    and author_email = (select lower(auth.jwt() ->> 'email'))
    and (order_id is null or exists (select 1 from public.cdf_orders o where o.id = order_id)));
revoke all on public.cdf_messages from public, anon;
grant select, insert on public.cdf_messages to authenticated;

-- How far each person has read each thread ('team' or an order id): drives the unread counters.
create table public.cdf_message_reads (
  member_email text not null,
  thread text not null check (thread = 'team' or thread ~ '^[0-9a-f-]{36}$'),
  last_read_at timestamptz not null default now(),
  primary key (member_email, thread)
);
alter table public.cdf_message_reads enable row level security;
create policy cdf_message_reads_own on public.cdf_message_reads for all to authenticated
  using (member_email = (select lower(auth.jwt() ->> 'email')))
  with check (member_email = (select lower(auth.jwt() ->> 'email')) and (select public.cdf_my_role()) is not null);
revoke all on public.cdf_message_reads from public, anon;
grant select, insert, update on public.cdf_message_reads to authenticated;

-- Names and photos of the team for the chat and @mentions. Florists and drivers can't read cdf_members
-- (phones, availability); this gives every member only what the chat needs.
create function public.cdf_team_directory()
returns table (email text, name text, role text, avatar_path text, username text)
language sql stable security definer set search_path = '' as $$
  select m.email, m.name, m.role, m.avatar_path, m.username
  from public.cdf_members m
  where public.cdf_my_role() is not null
  order by m.name
$$;
revoke all on function public.cdf_team_directory() from public, anon;
grant execute on function public.cdf_team_directory() to authenticated;

-- New messages reach open apps in real time (subject to the read policy above)
alter publication supabase_realtime add table public.cdf_messages;
