-- 11/11/2026. Phase 3: requests from the public form arrive in the panel, are reviewed, and are rejected or
-- accepted. Accepting creates the order (with its price and down payment) in the same transaction, through
-- Phase 1's cdf_create_order, so its rules apply unchanged.
-- Additive only: three tables, one column on cdf_request_files, functions, one storage policy and one
-- trigger. A request is not an order: it does not count as a sale or as work to prepare until accepted.

-- Preconditions: Phases 1 and 2.
do $$
begin
  if to_regprocedure('public.cdf_create_order(uuid, jsonb, numeric, jsonb)') is null
    or to_regclass('public.cdf_upload_sessions') is null or to_regclass('public.cdf_request_files') is null then
    raise exception 'cdf_order_requests needs the create-order (Phase 1) and public-uploads (Phase 2) migrations first';
  end if;
end $$;

-- 1) The request as the customer sent it. What is checked in the edge function is checked here again, so a
--    request can never hold what the form would not accept.
create table public.cdf_order_requests (
  id uuid primary key default gen_random_uuid(),
  ref bigint generated always as identity unique,          -- "R12": what the team and the customer can quote
  request_key uuid not null unique,                         -- the form's key: the same request sent twice is one
  session_id uuid references public.cdf_upload_sessions(id) on delete set null,
  status text not null default 'received' check (status in ('received', 'in_review', 'accepted', 'rejected', 'expired')),
  lang text not null default 'en' check (lang in ('en', 'es')),
  buyer_name text not null check (length(buyer_name) between 2 and 80),
  buyer_phone text not null check (buyer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  receiver_name text not null check (length(receiver_name) between 2 and 80),
  receiver_phone text not null check (receiver_phone ~ '^\+[1-9][0-9]{6,14}$'),
  mode text not null check (mode in ('delivery', 'pickup')),
  date date not null,
  slot text not null check (length(slot) between 5 and 20),
  address text not null default '' check (length(address) <= 300),
  lat numeric(9, 6), lng numeric(9, 6),
  location_source text check (location_source in ('search', 'pin', 'device')),
  location_confirmed_at timestamptz,
  description text not null check (length(description) between 3 and 1000),
  special_requests text not null default '' check (length(special_requests) <= 500),
  card_message text not null default '' check (length(card_message) <= 300),
  payment_method text not null check (payment_method in ('gcash', 'maya', 'bank', 'cash', 'other')),
  fingerprint text not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text check (length(reject_reason) <= 500),
  accepted_order_id uuid references public.cdf_orders(id) on delete set null,
  accepted_key uuid,
  version integer not null default 1,
  -- Delivery: a written address and a point the person confirmed, in the Philippines. Pickup: neither.
  constraint cdf_order_requests_place check (
    (mode = 'delivery' and length(address) >= 8 and lat between 4 and 21.5 and lng between 116 and 127
      and location_source is not null and location_confirmed_at is not null)
    or (mode = 'pickup' and lat is null and lng is null and location_source is null and location_confirmed_at is null)),
  constraint cdf_order_requests_accepted check ((status = 'accepted') = (accepted_key is not null))
);
create index cdf_order_requests_open on public.cdf_order_requests (status, created_at desc);
create index cdf_order_requests_buyer on public.cdf_order_requests (buyer_phone, date);
create index cdf_order_requests_receiver on public.cdf_order_requests (receiver_phone, date);
create index cdf_order_requests_order on public.cdf_order_requests (accepted_order_id);

-- 2) What happened to each request, and who did it.
create table public.cdf_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.cdf_order_requests(id) on delete cascade,
  kind text not null check (kind in ('received', 'opened', 'rejected', 'reopened', 'accepted')),
  by_email text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index cdf_request_events_request on public.cdf_request_events (request_id, created_at);

-- 3) Notices still to be confirmed as sent. One row per notice; the push function marks it done, and the
--    ones that never got there are sent again (cdf_outbox_retry), up to five times.
create table public.cdf_outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz
);
create index cdf_outbox_pending on public.cdf_outbox (created_at) where delivered_at is null;

-- 4) The photos and proof sent with a request now belong to it.
alter table public.cdf_request_files add column request_id uuid references public.cdf_order_requests(id) on delete set null;
create index cdf_request_files_request on public.cdf_request_files (request_id);

-- Who sees what: requests and their history are for admins. Staff never write them directly: every change
-- goes through the functions below. The outbox is for the server only.
alter table public.cdf_order_requests enable row level security;
alter table public.cdf_request_events enable row level security;
alter table public.cdf_outbox enable row level security;
revoke all on public.cdf_order_requests, public.cdf_request_events, public.cdf_outbox from public, anon, authenticated;
grant select on public.cdf_order_requests, public.cdf_request_events to authenticated;
grant all on public.cdf_order_requests, public.cdf_request_events, public.cdf_outbox to service_role;
create policy cdf_order_requests_admin_read on public.cdf_order_requests for select to authenticated using ((select public.cdf_is_admin()));
create policy cdf_request_events_admin_read on public.cdf_request_events for select to authenticated using ((select public.cdf_is_admin()));
-- Request files: admins see the ones attached to a request (never a stray upload that was not sent)
grant select on public.cdf_request_files to authenticated;
create policy cdf_request_files_admin_read on public.cdf_request_files for select to authenticated
  using ((select public.cdf_is_admin()) and request_id is not null and status = 'ready');

-- The panel hears about new and changed requests as they happen (Realtime follows the read policy above)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cdf_order_requests;
  end if;
end $$;

-- 5) Receive a request from the public form (edge function only). All of it or nothing: the request,
--    its files, the session closed and the notice queued. The same request sent again (double tap,
--    retry after a lost answer) returns the first one; the same key with different content is refused.
create function public.cdf_request_submit(p_token_hash text, p_ip_hash text, p_request jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_key uuid;
  v_fingerprint text;
  v_found public.cdf_order_requests%rowtype;
  v_session uuid;
  v_refs uuid[];
  v_proof uuid;
  v_id uuid;
  v_ref bigint;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_token_hash is null or p_request is null or jsonb_typeof(p_request) <> 'object' then raise exception 'cdf_invalid_request'; end if;
  begin v_key := (p_request->>'request_key')::uuid; exception when others then raise exception 'cdf_invalid_request'; end;
  if v_key is null then raise exception 'cdf_invalid_request'; end if;
  v_fingerprint := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');

  -- The session is locked first, so a second copy of this request arriving at the same moment waits here
  select id into v_session from public.cdf_upload_sessions
  where token_hash = p_token_hash and expires_at > now() and submitted_at is null for update;
  -- Already received (by an earlier copy, or by the one this copy waited for)?
  select * into v_found from public.cdf_order_requests where request_key = v_key;
  if found then
    if v_found.fingerprint <> v_fingerprint
      or not exists (select 1 from public.cdf_upload_sessions s where s.id = v_found.session_id and s.token_hash = p_token_hash) then
      raise exception 'cdf_operation_conflict';
    end if;
    return jsonb_build_object('id', v_found.id, 'ref', v_found.ref, 'replayed', true);
  end if;
  if v_session is null then raise exception 'cdf_session_invalid'; end if;

  -- The shop's day decides what "today" is
  if (p_request->>'date')::date < v_today or (p_request->>'date')::date > v_today + 90 then raise exception 'cdf_invalid_request'; end if;

  -- Only ready files from this session, of the right kind: six references at most and one proof
  v_refs := array(select (jsonb_array_elements_text(coalesce(p_request->'reference_files', '[]'::jsonb)))::uuid);
  v_proof := nullif(p_request->>'payment_proof', '')::uuid;
  if cardinality(v_refs) > 6
    or cardinality(v_refs) <> (select count(distinct f.id) from public.cdf_request_files f
      where f.session_id = v_session and f.kind = 'reference' and f.status = 'ready' and f.request_id is null and f.id = any (v_refs))
    or (v_proof is not null and not exists (select 1 from public.cdf_request_files f
      where f.session_id = v_session and f.kind = 'payment_proof' and f.status = 'ready' and f.request_id is null and f.id = v_proof)) then
    raise exception 'cdf_request_files';
  end if;

  insert into public.cdf_order_requests (request_key, session_id, lang, buyer_name, buyer_phone, receiver_name, receiver_phone,
    mode, date, slot, address, lat, lng, location_source, location_confirmed_at, description, special_requests, card_message,
    payment_method, fingerprint, ip_hash)
  select v_key, v_session, coalesce(r.lang, 'en'), r.buyer_name, r.buyer_phone, r.receiver_name, r.receiver_phone,
    r.mode, r.date, r.slot, coalesce(r.address, ''), r.lat, r.lng, r.location_source, r.location_confirmed_at, r.description,
    coalesce(r.special_requests, ''), coalesce(r.card_message, ''), r.payment_method, v_fingerprint, p_ip_hash
  from jsonb_to_record(p_request) as r(lang text, buyer_name text, buyer_phone text, receiver_name text, receiver_phone text,
    mode text, date date, slot text, address text, lat numeric, lng numeric, location_source text, location_confirmed_at timestamptz,
    description text, special_requests text, card_message text, payment_method text)
  returning id, ref into v_id, v_ref;

  update public.cdf_request_files set request_id = v_id
  where session_id = v_session and id = any (v_refs || case when v_proof is null then '{}'::uuid[] else array[v_proof] end);
  update public.cdf_upload_sessions set submitted_at = now() where id = v_session;
  insert into public.cdf_request_events (request_id, kind) values (v_id, 'received');
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'replayed', false);
end $$;

-- 6) The notice: every admin's phone hears "new request" (cdf-push), with no name, phone, address or
--    photo in it, since it may show on a locked screen. Queued in the same transaction as the request, so
--    a request is never announced unless it was saved, and a notice that does not get through is retried.
create function public.cdf_outbox_send(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.cdf_outbox%rowtype;
begin
  update public.cdf_outbox set attempts = attempts + 1, last_attempt_at = now()
  where id = p_id and delivered_at is null returning * into v_row;
  if found then perform public.cdf_push_hook(jsonb_build_object('kind', v_row.kind, 'id', v_row.ref_id, 'outbox', v_row.id)); end if;
end $$;

create function public.cdf_request_announce() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_outbox bigint;
begin
  insert into public.cdf_outbox (kind, ref_id) values ('request', new.id) returning id into v_outbox;
  perform public.cdf_outbox_send(v_outbox);
  return new;
end $$;
create trigger cdf_order_requests_announce after insert on public.cdf_order_requests
  for each row execute function public.cdf_request_announce();

-- The push function confirms a notice once it has done its part
create function public.cdf_outbox_done(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_outbox set delivered_at = coalesce(delivered_at, now()) where id = p_id
$$;

-- Send again what was not confirmed after two minutes; five tries at most. Returns how many went out.
-- Called by the public function on each request and, where the project has pg_cron, every five minutes.
create function public.cdf_outbox_retry() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_n integer := 0;
begin
  for v_id in select id from public.cdf_outbox
    where delivered_at is null and attempts < 5 and coalesce(last_attempt_at, created_at) < now() - interval '2 minutes'
    order by id limit 20 for update skip locked loop
    perform public.cdf_outbox_send(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 7) Reviewing, for admins. Every change is checked against the request as it is now, under a lock, so
--    two admins acting on the same request at once cannot both succeed.
create function public.cdf_request_admin() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_actor text := lower(auth.jwt()->>'email');
begin
  if auth.uid() is null or v_actor is null or not coalesce(public.cdf_is_admin(), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return v_actor;
end $$;

-- Opened by an admin: "received" becomes "in review", and the team sees who has it. Changes nothing else.
create function public.cdf_request_open(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.cdf_request_admin(); v_row public.cdf_order_requests%rowtype;
begin
  update public.cdf_order_requests set status = 'in_review', reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
  where id = p_id and status = 'received' returning * into v_row;
  if found then
    insert into public.cdf_request_events (request_id, kind, by_email) values (p_id, 'opened', v_actor);
  else
    select * into v_row from public.cdf_order_requests where id = p_id;
    if not found then raise exception 'cdf_request_gone'; end if;
  end if;
  return to_jsonb(v_row);
end $$;

create function public.cdf_request_reject(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.cdf_request_admin(); v_row public.cdf_order_requests%rowtype;
begin
  if length(p_reason) > 500 then raise exception 'cdf_invalid_request'; end if;
  select * into v_row from public.cdf_order_requests where id = p_id for update;
  if not found then raise exception 'cdf_request_gone'; end if;
  if v_row.status = 'rejected' then return to_jsonb(v_row); end if;          -- already done: same answer
  if v_row.status not in ('received', 'in_review') then raise exception 'cdf_request_closed'; end if;
  update public.cdf_order_requests set status = 'rejected', reject_reason = nullif(btrim(p_reason), ''), reviewed_by = v_actor,
    reviewed_at = now(), updated_at = now(), version = version + 1
  where id = p_id returning * into v_row;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (p_id, 'rejected', v_actor, jsonb_build_object('reason', v_row.reject_reason));
  return to_jsonb(v_row);
end $$;

-- A rejection by mistake can be undone; an accepted request cannot (its order is the record now)
create function public.cdf_request_reopen(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.cdf_request_admin(); v_row public.cdf_order_requests%rowtype;
begin
  select * into v_row from public.cdf_order_requests where id = p_id for update;
  if not found then raise exception 'cdf_request_gone'; end if;
  if v_row.status <> 'rejected' then raise exception 'cdf_request_closed'; end if;
  update public.cdf_order_requests set status = 'in_review', reject_reason = null, reviewed_by = v_actor, reviewed_at = now(),
    updated_at = now(), version = version + 1
  where id = p_id returning * into v_row;
  insert into public.cdf_request_events (request_id, kind, by_email) values (p_id, 'reopened', v_actor);
  return to_jsonb(v_row);
end $$;

-- Accept: create the order (as the admin wrote it in the editor, prefilled from the request) and close the
-- request, in one transaction. p_request is the operation key: sent again after a lost answer, it returns
-- the order already made; another admin's acceptance meanwhile is refused instead of making a second order.
create function public.cdf_request_accept(p_id uuid, p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.cdf_request_admin();
  v_row public.cdf_order_requests%rowtype;
  v_made jsonb;
  v_order uuid;
begin
  select * into v_row from public.cdf_order_requests where id = p_id for update;
  if not found then raise exception 'cdf_request_gone'; end if;
  if v_row.status = 'accepted' then
    if v_row.accepted_key is distinct from p_request then raise exception 'cdf_request_taken'; end if;
    -- The same acceptance again: Phase 1 returns the order it made (or says the content changed)
    return public.cdf_create_order(p_request, p_order, p_price, p_payment) || jsonb_build_object('request', to_jsonb(v_row));
  end if;
  if v_row.status not in ('received', 'in_review') then raise exception 'cdf_request_closed'; end if;

  v_made := public.cdf_create_order(p_request, p_order, p_price, p_payment);
  v_order := (v_made->'order'->>'id')::uuid;
  update public.cdf_order_requests set status = 'accepted', accepted_order_id = v_order, accepted_key = p_request,
    reviewed_by = v_actor, reviewed_at = now(), updated_at = now(), version = version + 1
  where id = p_id returning * into v_row;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (p_id, 'accepted', v_actor, jsonb_build_object('order_id', v_order, 'num', v_made->'order'->>'num'));
  return v_made || jsonb_build_object('request', to_jsonb(v_row));
end $$;

-- Other requests and orders that look like this one (same phone, same day): shown as a warning, never
-- a block, since two gifts to one person on one day are real.
create function public.cdf_request_similar(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_row public.cdf_order_requests%rowtype;
begin
  perform public.cdf_request_admin();
  select * into v_row from public.cdf_order_requests where id = p_id;
  if not found then raise exception 'cdf_request_gone'; end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'status', r.status) order by r.created_at)
      from public.cdf_order_requests r
      where r.id <> v_row.id and r.date = v_row.date and r.status <> 'rejected'
        and (r.buyer_phone in (v_row.buyer_phone, v_row.receiver_phone) or r.receiver_phone in (v_row.buyer_phone, v_row.receiver_phone))), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num) order by o.num)
      from public.cdf_orders o
      where o.date = v_row.date and o.cancelled_at is null and (o.id is distinct from v_row.accepted_order_id)
        and (o.buyer_phone in (v_row.buyer_phone, v_row.receiver_phone) or o.customer_phone in (v_row.buyer_phone, v_row.receiver_phone))), '[]'));
end $$;

-- 8) Photos of a request, from its order. Admins get every file of the request it came from; the florist the
--    order is assigned to gets the reference photos (never the payment proof). Others get nothing.
create function public.cdf_order_references(p_order uuid) returns table (id uuid, kind text, path text, width integer, height integer, request_ref bigint)
language sql stable security definer set search_path = '' as $$
  select f.id, f.kind, f.path, f.width, f.height, r.ref
  from public.cdf_order_requests r
  join public.cdf_request_files f on f.request_id = r.id and f.status = 'ready'
  join public.cdf_orders o on o.id = r.accepted_order_id
  where r.accepted_order_id = p_order
    and (coalesce(public.cdf_is_admin(), false)
      or (f.kind = 'reference' and o.vendor_email = lower(coalesce(auth.jwt()->>'email', ''))))
  order by f.kind desc, f.created_at
$$;

-- Reading the files themselves (short-lived signed links, as with the other private buckets) follows the
-- same rule: admins for files attached to a request; the assigned florist for her order's reference photos.
create function public.cdf_can_read_request_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cdf_request_files f
    left join public.cdf_order_requests r on r.id = f.request_id
    left join public.cdf_orders o on o.id = r.accepted_order_id
    where f.path = p_name and f.request_id is not null and f.status = 'ready'
      and (coalesce(public.cdf_is_admin(), false)
        or (f.kind = 'reference' and o.vendor_email = lower(coalesce(auth.jwt()->>'email', '')))))
$$;
create policy cdf_solicitudes_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-solicitudes' and (select public.cdf_can_read_request_file(name)));

-- Grants: the public function (service role) receives requests and confirms notices; signed-in admins review.
do $$
declare fn text;
begin
  foreach fn in array array['public.cdf_request_submit(text, text, jsonb)', 'public.cdf_outbox_done(bigint)', 'public.cdf_outbox_retry()',
    'public.cdf_outbox_send(bigint)', 'public.cdf_request_announce()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['public.cdf_request_admin()', 'public.cdf_request_open(uuid)', 'public.cdf_request_reject(uuid, text)',
    'public.cdf_request_reopen(uuid)', 'public.cdf_request_accept(uuid, uuid, jsonb, numeric, jsonb)', 'public.cdf_request_similar(uuid)',
    'public.cdf_order_references(uuid)', 'public.cdf_can_read_request_file(text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- Where the project has pg_cron, notices that did not get through are retried every five minutes
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cdf-outbox-retry', '*/5 * * * *', 'select public.cdf_outbox_retry()');
  end if;
end $$;
