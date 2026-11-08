-- Private (direct) chats send a push to the other person, like #team and order chats already do.
-- cdf-push works out who that is from the thread; the author never hears about their own message.

create function public.cdf_push_direct() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.cdf_push_hook(jsonb_build_object('kind', 'direct', 'id', new.id));
  return new;
end $$;
revoke all on function public.cdf_push_direct() from public, anon, authenticated;
create trigger cdf_direct_messages_push after insert on public.cdf_direct_messages
  for each row execute function public.cdf_push_direct();
