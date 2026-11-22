-- 22/11/2026 (branch paymongo-solicitudes, NOT applied in production). A private link for the customer to come back
-- to their request: while the team prepares the price it says so, and once an admin opens a PayMongo link it shows the
-- total and the button to pay. The admin's message stays the main way; this page is the backup if it gets lost.
-- Additive only: one table and two server-only functions. Nothing existing changes behaviour.

do $$
begin
  if to_regclass('public.cdf_request_payments') is null then
    raise exception 'cdf_request_status_link needs cdf_request_paymongo first';
  end if;
end $$;

-- Only the hash of the customer's secret is kept: the secret itself lives in their link (after the #) and nowhere else
create table public.cdf_request_access (
  request_id uuid primary key references public.cdf_order_requests(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.cdf_request_access enable row level security;
revoke all on public.cdf_request_access from public, anon, authenticated;
grant all on public.cdf_request_access to service_role;

-- Right after the request is stored (cdf-public-order, service role). Only the session that sent the request can get
-- its link; sending the same request again (a retry) gets a new link and the old one stops working.
create function public.cdf_request_access_set(p_request uuid, p_session_hash text, p_token_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'cdf_invalid_token'; end if;
  if not exists (select 1 from public.cdf_order_requests r join public.cdf_upload_sessions s on s.id = r.session_id
                 where r.id = p_request and s.token_hash = p_session_hash) then
    return false;
  end if;
  insert into public.cdf_request_access (request_id, token_hash) values (p_request, p_token_hash)
  on conflict (request_id) do update set token_hash = excluded.token_hash, created_at = now();
  return true;
end $$;

-- What the customer's page shows (cdf-paymongo, service role): the request's state and, when there is one, the open
-- payment link (its secret, so the page can send them to pagar.html) or the payment already made.
create function public.cdf_request_status_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', r.ref, 'shared_number', r.shared_number, 'status', r.status, 'lang', r.lang,
    'date', r.date, 'slot', r.slot, 'mode', r.mode, 'receiver', r.receiver_name, 'pickup_branch', r.pickup_branch,
    'pay', (select jsonb_build_object('status', p.status, 'amount', p.amount, 'paid_at', p.paid_at,
                     'token', case when p.status = 'open' then p.token end)
            from public.cdf_request_payments p
            where p.request_id = r.id and p.status in ('open', 'paid')
            order by (p.status = 'paid') desc, p.created_at desc limit 1))
  from public.cdf_request_access a join public.cdf_order_requests r on r.id = a.request_id
  where a.token_hash = p_token_hash
$$;

revoke execute on function public.cdf_request_access_set(uuid, text, text), public.cdf_request_status_view(text) from public, anon, authenticated;
grant execute on function public.cdf_request_access_set(uuid, text, text), public.cdf_request_status_view(text) to service_role;
