-- Chat reactions (👍 ✅ ❤️ …): one row per person, message and emoji.
-- Who sees them follows the message (and so the order): the policy only asks "can you read this message?".
create table public.cdf_message_reactions (
  message_id uuid not null references public.cdf_messages(id) on delete cascade,
  member_email text not null,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, member_email, emoji)
);
create index cdf_message_reactions_msg_idx on public.cdf_message_reactions (message_id);
alter table public.cdf_message_reactions enable row level security;

create policy cdf_message_reactions_read on public.cdf_message_reactions for select to authenticated
  using (exists (select 1 from public.cdf_messages m where m.id = message_id));
create policy cdf_message_reactions_add on public.cdf_message_reactions for insert to authenticated
  with check (member_email = (select lower(auth.jwt() ->> 'email'))
    and (select public.cdf_my_role()) is not null
    and exists (select 1 from public.cdf_messages m where m.id = message_id));
create policy cdf_message_reactions_remove on public.cdf_message_reactions for delete to authenticated
  using (member_email = (select lower(auth.jwt() ->> 'email')));
revoke all on public.cdf_message_reactions from public, anon;
grant select, insert, delete on public.cdf_message_reactions to authenticated;

-- Removed reactions must reach other screens: send the whole old row on delete
alter table public.cdf_message_reactions replica identity full;
alter publication supabase_realtime add table public.cdf_message_reactions;
