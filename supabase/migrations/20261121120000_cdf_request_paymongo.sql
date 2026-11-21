-- 21/11/2026 (branch paymongo-solicitudes, NOT applied in production). Requests paid online with PayMongo.
-- An admin prepares the order exactly as when accepting (same editor), but instead of creating it now, it is kept
-- with a private payment link for the customer. When PayMongo confirms the payment (webhook or a check), the request
-- is accepted and the order created with that payment, in one transaction, as if that admin had pressed Accept.
-- Additive only: two tables, three event kinds, functions. Nothing existing changes behaviour.

do $$
begin
  if to_regprocedure('public.cdf_request_accept(uuid, uuid, jsonb, numeric, jsonb)') is null then
    raise exception 'cdf_request_paymongo needs the requests (Phase 3) and shared numbering migrations first';
  end if;
end $$;

-- 1) One payment link per request at a time (a new price cancels the previous link)
create table public.cdf_request_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.cdf_order_requests(id) on delete cascade,
  token text not null,                                   -- the secret in the customer's link (admins can copy it again)
  token_hash text not null unique,                       -- sha256 of it: how the customer's page finds the link
  amount numeric(10, 2) not null check (amount between 100 and 1000000 and amount = round(amount, 2)),
  accept_key uuid not null,                              -- the editor's operation key: the order it will create
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),   -- the order as the admin left it in the editor
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  created_by text not null,
  created_by_uid uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checkout_id text,                                      -- the PayMongo page currently open for it, if any
  checkout_url text,
  checkout_expires_at timestamptz,
  payment_id text unique,                                -- PayMongo's payment, once paid
  method text,
  paid_amount numeric(10, 2),
  paid_at timestamptz,
  order_id uuid references public.cdf_orders(id) on delete set null,
  issue text check (length(issue) <= 500)                -- a payment that could not be applied: the team checks it
);
create unique index cdf_request_payments_one_open on public.cdf_request_payments (request_id) where status = 'open';
create index cdf_request_payments_request on public.cdf_request_payments (request_id, created_at desc);

-- 2) Every PayMongo event, stored before it is applied (so a failure is retried, never lost)
create table public.cdf_paymongo_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  done_at timestamptz,
  error text
);

alter table public.cdf_request_payments enable row level security;
alter table public.cdf_paymongo_events enable row level security;
revoke all on public.cdf_request_payments, public.cdf_paymongo_events from public, anon, authenticated;
grant select on public.cdf_request_payments to authenticated;
grant all on public.cdf_request_payments, public.cdf_paymongo_events to service_role;
-- Admins see the links (never the token: only its hash is stored). Florists and drivers see nothing.
create policy cdf_request_payments_admin_read on public.cdf_request_payments for select to authenticated using ((select public.cdf_is_admin()));
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cdf_request_payments;
  end if;
end $$;

alter table public.cdf_request_events drop constraint cdf_request_events_kind_check;
alter table public.cdf_request_events add constraint cdf_request_events_kind_check
  check (kind in ('received', 'opened', 'rejected', 'reopened', 'accepted', 'expired', 'pay_link', 'pay_link_cancelled', 'paid'));

-- 3) Admin: keep the order for later and open a payment link (called by the cdf-paymongo function with the admin's
--    own token, so the admin check is the database's). Returns the previous open PayMongo page, to expire it there.
create function public.cdf_request_paylink(p_id uuid, p_token text, p_key uuid, p_order jsonb, p_price numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.cdf_request_admin();
  v_row public.cdf_order_requests%rowtype;
  v_prev public.cdf_request_payments%rowtype;
  v_pay public.cdf_request_payments%rowtype;
begin
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_-]{40,80}$' or p_key is null or p_order is null or jsonb_typeof(p_order) <> 'object'
    or p_price is null or not (p_price between 100 and 1000000 and p_price = round(p_price, 2)) then
    raise exception 'cdf_invalid_payment';
  end if;
  select * into v_row from public.cdf_order_requests where id = p_id for update;
  if not found then raise exception 'cdf_request_gone'; end if;
  if v_row.status not in ('received', 'in_review') then raise exception 'cdf_request_closed'; end if;
  update public.cdf_request_payments set status = 'cancelled', updated_at = now()
  where request_id = p_id and status = 'open' returning * into v_prev;
  if v_prev.id is not null then
    insert into public.cdf_request_events (request_id, kind, by_email, detail)
    values (p_id, 'pay_link_cancelled', v_actor, jsonb_build_object('amount', v_prev.amount, 'replaced', true));
  end if;
  insert into public.cdf_request_payments (request_id, token, token_hash, amount, accept_key, draft, created_by, created_by_uid)
  values (p_id, p_token, encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), p_price, p_key, p_order, v_actor, auth.uid()) returning * into v_pay;
  update public.cdf_order_requests set status = 'in_review', reviewed_by = v_actor, reviewed_at = now(), updated_at = now(), version = version + 1
  where id = p_id and status = 'received';
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (p_id, 'pay_link', v_actor, jsonb_build_object('amount', p_price));
  return jsonb_build_object('payment', v_pay.id, 'amount', v_pay.amount, 'previous_checkout', v_prev.checkout_id);
end $$;

-- Admin: cancel the open link (the customer's page then says it is no longer valid)
create function public.cdf_request_paylink_cancel(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.cdf_request_admin();
  v_prev public.cdf_request_payments%rowtype;
begin
  update public.cdf_request_payments set status = 'cancelled', updated_at = now()
  where request_id = p_id and status = 'open' returning * into v_prev;
  if v_prev.id is null then return jsonb_build_object('cancelled', false); end if;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (p_id, 'pay_link_cancelled', v_actor, jsonb_build_object('amount', v_prev.amount));
  return jsonb_build_object('cancelled', true, 'previous_checkout', v_prev.checkout_id);
end $$;

-- 4) Server only (service role): what the customer's page shows. Nothing private beyond what they sent.
create function public.cdf_paylink_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
    'checkout_url', case when p.checkout_expires_at > now() + interval '2 minutes' then p.checkout_url end,
    'checkout_id', p.checkout_id, 'checkout_expires_at', p.checkout_expires_at,
    'ref', r.ref, 'shared_number', r.shared_number, 'request_status', r.status, 'lang', r.lang,
    'date', r.date, 'slot', r.slot, 'mode', r.mode, 'receiver', r.receiver_name, 'pickup_branch', r.pickup_branch,
    'replaced', p.status = 'cancelled' and exists (select 1 from public.cdf_request_payments n where n.request_id = p.request_id and n.status = 'open'))
  from public.cdf_request_payments p join public.cdf_order_requests r on r.id = p.request_id
  where p.token_hash = p_token_hash
$$;

-- The PayMongo page opened for a link (or cleared after it expired). Only while the link is open.
create function public.cdf_paylink_checkout(p_payment uuid, p_checkout_id text, p_url text, p_expires timestamptz) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.cdf_request_payments set checkout_id = p_checkout_id, checkout_url = p_url, checkout_expires_at = p_expires, updated_at = now()
    where id = p_payment and status = 'open' returning 1)
  select exists (select 1 from u)
$$;

-- 5) The payment is confirmed (webhook or check). Idempotent. Accepts the request and creates the order exactly as
--    cdf_request_accept does, acting as the admin who made the link (their name stays on the order's history).
--    Anything that does not fit (cancelled link, closed request, other amount) is kept as an issue for the team.
create function public.cdf_paylink_settle(p_payment uuid, p_payment_id text, p_amount numeric, p_method text, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.cdf_request_payments%rowtype;
  v_req public.cdf_order_requests%rowtype;
  v_made jsonb;
  v_issue text;
begin
  select * into v_pay from public.cdf_request_payments where id = p_payment for update;
  if not found then raise exception 'cdf_payment_gone'; end if;
  if v_pay.status = 'paid' then
    return jsonb_build_object('result', case when v_pay.payment_id = p_payment_id then 'already' else 'other_payment' end, 'order', v_pay.order_id);
  end if;
  select * into v_req from public.cdf_order_requests where id = v_pay.request_id for update;
  v_issue := case
    when v_pay.status = 'cancelled' then 'paid_after_cancel'
    when p_amount is distinct from v_pay.amount then 'amount_mismatch'
    when v_req.status not in ('received', 'in_review') then 'request_closed_' || v_req.status
  end;
  if v_issue is not null then
    update public.cdf_request_payments set issue = v_issue || ' · ' || p_payment_id || ' · ' || p_amount, updated_at = now() where id = p_payment;
    return jsonb_build_object('result', 'issue', 'issue', v_issue);
  end if;
  -- Act as the admin who prepared it: the same checks, numbering and history as pressing Accept
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_pay.created_by_uid, 'email', v_pay.created_by, 'role', 'authenticated')::text, true);
  begin
    v_made := public.cdf_request_accept(v_pay.request_id, v_pay.accept_key, v_pay.draft, v_pay.amount,
      jsonb_build_object('amount', p_amount, 'method', coalesce(nullif(p_method, ''), 'other'), 'reference', 'PayMongo ' || p_payment_id,
        'paid_at', to_char(p_paid_at at time zone 'Asia/Manila', 'YYYY-MM-DD')));
  exception when others then
    -- e.g. that admin no longer has access, or the order no longer passes the rules: the money is in, the team decides
    perform set_config('request.jwt.claims', '', true);
    update public.cdf_request_payments set issue = left('accept_failed · ' || sqlerrm || ' · ' || p_payment_id, 500), updated_at = now() where id = p_payment;
    return jsonb_build_object('result', 'issue', 'issue', 'accept_failed', 'detail', sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);
  update public.cdf_request_payments set status = 'paid', payment_id = p_payment_id, paid_amount = p_amount, method = p_method,
    paid_at = p_paid_at, order_id = (v_made->'order'->>'id')::uuid, checkout_url = null, updated_at = now()
  where id = p_payment;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (v_pay.request_id, 'paid', 'PayMongo', jsonb_build_object('amount', p_amount, 'method', p_method, 'payment_id', p_payment_id));
  return jsonb_build_object('result', 'paid', 'order', v_made->'order'->>'id', 'num', v_made->'order'->>'num');
end $$;

revoke execute on function public.cdf_request_paylink(uuid, text, uuid, jsonb, numeric), public.cdf_request_paylink_cancel(uuid),
  public.cdf_paylink_view(text), public.cdf_paylink_checkout(uuid, text, text, timestamptz),
  public.cdf_paylink_settle(uuid, text, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cdf_request_paylink(uuid, text, uuid, jsonb, numeric), public.cdf_request_paylink_cancel(uuid) to authenticated;
grant execute on function public.cdf_paylink_view(text), public.cdf_paylink_checkout(uuid, text, text, timestamptz),
  public.cdf_paylink_settle(uuid, text, numeric, text, timestamptz) to service_role;

-- 6) Webhook bookkeeping (service role): store first, mark done at the end; a stored event not done is retried
create function public.cdf_paymongo_event_store(p_id text, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_done timestamptz;
begin
  insert into public.cdf_paymongo_events (id, type, payload) values (p_id, p_type, p_payload) on conflict (id) do nothing;
  select done_at into v_done from public.cdf_paymongo_events where id = p_id;
  return jsonb_build_object('done', v_done is not null);
end $$;
create function public.cdf_paymongo_event_done(p_id text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_paymongo_events set done_at = case when p_error is null then now() end, error = p_error where id = p_id
$$;
-- The link a PayMongo session belongs to (its reference_number is the link id); null when it is not one of ours
create function public.cdf_paylink_by_id(p_payment text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'request_status', r.status)
  from public.cdf_request_payments p join public.cdf_order_requests r on r.id = p.request_id
  where p_payment ~ '^[0-9a-f-]{36}$' and p.id = p_payment::uuid
$$;
revoke execute on function public.cdf_paymongo_event_store(text, text, jsonb), public.cdf_paymongo_event_done(text, text),
  public.cdf_paylink_by_id(text) from public, anon, authenticated;
grant execute on function public.cdf_paymongo_event_store(text, text, jsonb), public.cdf_paymongo_event_done(text, text),
  public.cdf_paylink_by_id(text) to service_role;
