-- After paying, the customer's pages link to the order's tracking page (/p/<code>). The code is only given once
-- the link is paid and the order exists; it is the same code the shop already shares with the customer.
create or replace function public.cdf_paylink_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
    'checkout_url', case when p.checkout_expires_at > now() + interval '2 minutes' then p.checkout_url end,
    'checkout_id', p.checkout_id, 'checkout_expires_at', p.checkout_expires_at,
    'ref', r.ref, 'shared_number', r.shared_number, 'request_status', r.status, 'lang', r.lang,
    'date', r.date, 'slot', r.slot, 'mode', r.mode, 'receiver', r.receiver_name, 'pickup_branch', r.pickup_branch,
    'review', p.issue is not null,
    'replaced', p.status = 'cancelled' and exists (select 1 from public.cdf_request_payments n where n.request_id = p.request_id and n.status = 'open'),
    'track_code', case when p.status = 'paid' then (select o.code from public.cdf_orders o where o.id = r.accepted_order_id and o.cancelled_at is null) end)
  from public.cdf_request_payments p join public.cdf_order_requests r on r.id = p.request_id
  where p.token_hash = p_token_hash
$$;

create or replace function public.cdf_request_status_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ref', r.ref, 'shared_number', r.shared_number, 'status', r.status, 'lang', r.lang,
    'date', r.date, 'slot', r.slot, 'mode', r.mode, 'receiver', r.receiver_name, 'pickup_branch', r.pickup_branch,
    'pay', (select jsonb_build_object('status', p.status, 'amount', p.amount, 'paid_at', p.paid_at,
                     'token', case when p.status = 'open' then p.token end)
            from public.cdf_request_payments p
            where p.request_id = r.id and p.status in ('open', 'paid')
            order by (p.status = 'paid') desc, p.created_at desc limit 1),
    'track_code', case when r.status = 'accepted' then (select o.code from public.cdf_orders o where o.id = r.accepted_order_id and o.cancelled_at is null) end)
  from public.cdf_request_access a join public.cdf_order_requests r on r.id = a.request_id
  where a.token_hash = p_token_hash
$$;
