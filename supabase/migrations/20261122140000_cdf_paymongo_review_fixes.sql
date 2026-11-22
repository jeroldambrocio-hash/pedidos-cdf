-- 22/11/2026 (branch paymongo-solicitudes, NOT applied in production). Fixes from the /review of the PayMongo branch:
--  · A payment that cannot be applied (a second payment, paid after the link was cancelled, another amount, the
--    request already closed, PayMongo's answer not matching) is never silent: it is added to the link's issues
--    (kept, not overwritten), written in the request's history and every admin's phone hears it.
--  · A link with a problem stops offering the PayMongo page (the customer sees that the team is checking it).
--  · Only one PayMongo page per link at a time: a second page opened at the same moment is refused (the function
--    then closes it at PayMongo).
--  · A request that leaves "new / in review" (rejected, accepted without online payment, expired) cancels its open
--    link, so its page no longer offers to pay. The panel also closes the PayMongo page first.
--  · A link that no longer exists answers "gone" instead of failing forever (PayMongo would retry until it turns
--    the webhook off).

do $$
begin
  if to_regclass('public.cdf_request_payments') is null then
    raise exception 'cdf_paymongo_review_fixes needs cdf_request_paymongo first';
  end if;
end $$;

alter table public.cdf_request_payments drop constraint if exists cdf_request_payments_issue_check;
alter table public.cdf_request_payments add constraint cdf_request_payments_issue_check check (length(issue) <= 2000);

alter table public.cdf_request_events drop constraint cdf_request_events_kind_check;
alter table public.cdf_request_events add constraint cdf_request_events_kind_check
  check (kind in ('received', 'opened', 'rejected', 'reopened', 'accepted', 'expired', 'pay_link', 'pay_link_cancelled', 'paid', 'pay_issue'));

-- A payment problem: added to the link's issues, in the request's history, and pushed to every admin.
-- p_key identifies the problem (PayMongo's payment or session id): the same problem twice (webhook + the
-- customer's check) is recorded once.
create function public.cdf_paylink_flag(p_payment uuid, p_issue text, p_key text, p_amount numeric) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.cdf_request_payments%rowtype;
  v_line text := left(p_issue || ' · ' || coalesce(p_key, '?') || coalesce(' · ' || p_amount::text, ''), 300);
  v_outbox bigint;
begin
  select * into v_pay from public.cdf_request_payments where id = p_payment for update;
  if not found then return false; end if;
  if p_key is not null and position(p_key in coalesce(v_pay.issue, '')) > 0 then return false; end if;
  update public.cdf_request_payments
    set issue = right(concat_ws(E'\n', v_pay.issue, v_line), 2000), checkout_url = null, checkout_expires_at = null, updated_at = now()
    where id = p_payment;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (v_pay.request_id, 'pay_issue', 'PayMongo', jsonb_strip_nulls(jsonb_build_object('issue', p_issue, 'key', p_key, 'amount', p_amount)));
  insert into public.cdf_outbox (kind, ref_id) values ('pay_issue', v_pay.request_id) returning id into v_outbox;
  perform public.cdf_outbox_send(v_outbox);
  return true;
end $$;

-- The server's own checks of PayMongo's answer that will never pass on a retry (cdf-paymongo)
create function public.cdf_paylink_issue(p_payment uuid, p_issue text, p_key text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('result', 'issue', 'issue', p_issue, 'recorded', public.cdf_paylink_flag(p_payment, p_issue, p_key, null))
$$;

create or replace function public.cdf_paylink_settle(p_payment uuid, p_payment_id text, p_amount numeric, p_method text, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.cdf_request_payments%rowtype;
  v_req public.cdf_order_requests%rowtype;
  v_made jsonb;
  v_issue text;
begin
  select * into v_pay from public.cdf_request_payments where id = p_payment for update;
  if not found then return jsonb_build_object('result', 'gone'); end if;
  if v_pay.status = 'paid' and v_pay.payment_id = p_payment_id then
    return jsonb_build_object('result', 'already', 'order', v_pay.order_id);
  end if;
  -- Already recorded as a problem (the webhook and the customer's check both arrive)
  if position(p_payment_id in coalesce(v_pay.issue, '')) > 0 then
    return jsonb_build_object('result', 'issue', 'issue', 'known');
  end if;
  select * into v_req from public.cdf_order_requests where id = v_pay.request_id for update;
  v_issue := case
    when v_pay.status = 'paid' then 'other_payment'                 -- a second payment for a link already paid
    when v_pay.status = 'cancelled' then 'paid_after_cancel'
    when p_amount is distinct from v_pay.amount then 'amount_mismatch'
    when v_req.status not in ('received', 'in_review') then 'request_closed_' || v_req.status
  end;
  if v_issue is not null then
    perform public.cdf_paylink_flag(p_payment, v_issue, p_payment_id, p_amount);
    return jsonb_build_object('result', 'issue', 'issue', v_issue);
  end if;
  -- Act as the admin who prepared it: the same checks, numbering and history as pressing Accept. While it runs,
  -- the trigger below must not cancel this very link (the request is leaving "in review" because of it).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_pay.created_by_uid, 'email', v_pay.created_by, 'role', 'authenticated')::text, true);
  perform set_config('cdf.settling', p_payment::text, true);
  begin
    v_made := public.cdf_request_accept(v_pay.request_id, v_pay.accept_key, v_pay.draft, v_pay.amount,
      jsonb_build_object('amount', p_amount, 'method', coalesce(nullif(p_method, ''), 'other'), 'reference', 'PayMongo ' || p_payment_id,
        'paid_at', to_char(p_paid_at at time zone 'Asia/Manila', 'YYYY-MM-DD')));
  exception when others then
    -- e.g. that admin no longer has access, or the order no longer passes the rules: the money is in, the team decides
    perform set_config('request.jwt.claims', '', true);
    perform set_config('cdf.settling', '', true);
    perform public.cdf_paylink_flag(p_payment, left('accept_failed: ' || sqlerrm, 200), p_payment_id, p_amount);
    return jsonb_build_object('result', 'issue', 'issue', 'accept_failed', 'detail', sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('cdf.settling', '', true);
  update public.cdf_request_payments set status = 'paid', payment_id = p_payment_id, paid_amount = p_amount, method = p_method,
    paid_at = p_paid_at, order_id = (v_made->'order'->>'id')::uuid, checkout_url = null, updated_at = now()
  where id = p_payment;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (v_pay.request_id, 'paid', 'PayMongo', jsonb_build_object('amount', p_amount, 'method', p_method, 'payment_id', p_payment_id));
  return jsonb_build_object('result', 'paid', 'order', v_made->'order'->>'id', 'num', v_made->'order'->>'num');
end $$;

-- The customer's page: "review" when a payment arrived but could not be applied (no new PayMongo page then)
create or replace function public.cdf_paylink_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'paid_at', p.paid_at, 'method', p.method,
    'checkout_url', case when p.checkout_expires_at > now() + interval '2 minutes' then p.checkout_url end,
    'checkout_id', p.checkout_id, 'checkout_expires_at', p.checkout_expires_at,
    'ref', r.ref, 'shared_number', r.shared_number, 'request_status', r.status, 'lang', r.lang,
    'date', r.date, 'slot', r.slot, 'mode', r.mode, 'receiver', r.receiver_name, 'pickup_branch', r.pickup_branch,
    'review', p.issue is not null,
    'replaced', p.status = 'cancelled' and exists (select 1 from public.cdf_request_payments n where n.request_id = p.request_id and n.status = 'open'))
  from public.cdf_request_payments p join public.cdf_order_requests r on r.id = p.request_id
  where p.token_hash = p_token_hash
$$;

-- One PayMongo page per link: it is saved only if the link still has the page the caller saw (p_prev). Two
-- "Pay" taps at the same moment: the second one is refused here and its page is closed by the function.
drop function public.cdf_paylink_checkout(uuid, text, text, timestamptz);
create function public.cdf_paylink_checkout(p_payment uuid, p_prev text, p_checkout_id text, p_url text, p_expires timestamptz) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.cdf_request_payments set checkout_id = p_checkout_id, checkout_url = p_url, checkout_expires_at = p_expires, updated_at = now()
    where id = p_payment and status = 'open' and issue is null and checkout_id is not distinct from p_prev returning 1)
  select exists (select 1 from u)
$$;

-- A request that leaves "new / in review" by any way other than its own payment cancels its open link
create function public.cdf_request_close_paylinks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prev public.cdf_request_payments%rowtype;
begin
  for v_prev in
    update public.cdf_request_payments set status = 'cancelled', checkout_url = null, updated_at = now()
    where request_id = new.id and status = 'open' and id::text is distinct from nullif(current_setting('cdf.settling', true), '')
    returning *
  loop
    insert into public.cdf_request_events (request_id, kind, by_email, detail)
    values (new.id, 'pay_link_cancelled', lower(auth.jwt()->>'email'), jsonb_build_object('amount', v_prev.amount, 'closed', new.status));
  end loop;
  return null;
end $$;
create trigger cdf_request_close_paylinks after update of status on public.cdf_order_requests
  for each row when (old.status in ('received', 'in_review') and new.status not in ('received', 'in_review'))
  execute function public.cdf_request_close_paylinks();

revoke execute on function public.cdf_paylink_flag(uuid, text, text, numeric), public.cdf_paylink_issue(uuid, text, text),
  public.cdf_paylink_checkout(uuid, text, text, text, timestamptz), public.cdf_request_close_paylinks() from public, anon, authenticated;
grant execute on function public.cdf_paylink_issue(uuid, text, text), public.cdf_paylink_checkout(uuid, text, text, text, timestamptz) to service_role;
