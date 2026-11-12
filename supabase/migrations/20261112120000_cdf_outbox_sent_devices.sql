-- 12/11/2026 (final review). A notice from the outbox stays pending while some device had a temporary failure
-- (503, network), so it is sent again; the devices that already got it are remembered here and are not sent it
-- twice. Additive: one column and one function, for the server only (cdf-push).
alter table public.cdf_outbox add column sent_endpoints text[] not null default '{}';

create function public.cdf_outbox_sent(p_id bigint, p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_outbox set sent_endpoints = array_append(sent_endpoints, p_endpoint)
  where id = p_id and not (p_endpoint = any (sent_endpoints))
$$;
revoke all on function public.cdf_outbox_sent(bigint, text) from public, anon, authenticated;
grant execute on function public.cdf_outbox_sent(bigint, text) to service_role;
