begin;

alter table public.cdf_messages add column edited_at timestamptz;
alter table public.cdf_direct_messages add column edited_at timestamptz;

create function public.cdf_stamp_message_edit()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.edited_at := case when tg_op = 'UPDATE' then statement_timestamp() end;
  return new;
end;
$$;
revoke all on function public.cdf_stamp_message_edit() from public, anon, authenticated;
create trigger cdf_message_edited before insert or update of body on public.cdf_messages
  for each row execute function public.cdf_stamp_message_edit();
create trigger cdf_direct_message_edited before insert or update of body on public.cdf_direct_messages
  for each row execute function public.cdf_stamp_message_edit();

grant update (body) on public.cdf_messages, public.cdf_direct_messages to authenticated;
-- A writer must still have access to the conversation under its existing SELECT policy.
create policy cdf_messages_edit_own on public.cdf_messages for update to authenticated
  using (author_email = (select lower(auth.jwt() ->> 'email'))
    and (select public.cdf_my_role()) is not null
    and (order_id is null or exists (select 1 from public.cdf_orders o where o.id = order_id)))
  with check (author_email = (select lower(auth.jwt() ->> 'email'))
    and (select public.cdf_my_role()) is not null
    and (order_id is null or exists (select 1 from public.cdf_orders o where o.id = order_id)));

create policy cdf_direct_messages_edit_own on public.cdf_direct_messages for update to authenticated
  using (author_email = (select lower(auth.jwt() ->> 'email'))
    and (select public.cdf_my_role()) is not null
    and exists (select 1 from public.cdf_direct_threads d
      where d.id = direct_id and (select lower(auth.jwt() ->> 'email')) in (d.member_a, d.member_b)))
  with check (author_email = (select lower(auth.jwt() ->> 'email'))
    and (select public.cdf_my_role()) is not null
    and exists (select 1 from public.cdf_direct_threads d
      where d.id = direct_id and (select lower(auth.jwt() ->> 'email')) in (d.member_a, d.member_b)));

commit;
