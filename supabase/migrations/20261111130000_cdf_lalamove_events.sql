-- Phase 5 (11/11/2026). Lalamove: a webhook that never loses an event, the history of every rider booking
-- an order has had, and the proofs (delivery photo or signature, pickup photo) kept in our own storage.
-- Additive only: three tables, one private bucket, functions for the cdf-lalamove function (service role)
-- and a trigger that copies each booking of cdf_lalamove into the history. cdf_lalamove keeps working as
-- before; nothing existing is renamed, dropped or rewritten.
--
-- What Lalamove documents and what it does not (developers.lalamove.com, webhook deck v1.5, April 2026):
--   · event types: ORDER_STATUS_CHANGED, DRIVER_ASSIGNED, ORDER_AMOUNT_CHANGED, ORDER_REPLACED,
--     WALLET_BALANCE_CHANGED, ORDER_EDITED, POD_STATUS_CHANGED, POP_STATUS_CHANGED,
--     DELIVERY_CODE_STATUS_CHANGED, ORDER_CREATED. Ten tries in 24 hours, then the URL is disabled.
--     Updates may arrive out of order and fields "are subject to change".
--   · GET /v3/orders/{id}: stops[].POD = { status, image, deliveredAt }, status PENDING / DELIVERED /
--     SIGNED / FAILED.
--   · Not documented in text: the payload of each event, the signature formula, POP fields, how long an
--     image link lasts. So every event is stored as received, and the order is always read back from
--     GET /v3/orders before anything changes (that read is the source of truth, whatever order events
--     arrive in).

-- 1) Every webhook call, stored before Lalamove gets its 200. Same event twice = one row.
create table public.cdf_lalamove_events (
  id bigint generated always as identity primary key,
  env text not null check (env in ('sandbox', 'production')),
  event_key text not null unique,          -- Lalamove's eventId when there is one, else a hash of the body
  event_type text not null,
  ll_order_id text,
  event_at timestamptz,                    -- when Lalamove says it happened (to sort; may be null)
  received_at timestamptz not null default now(),
  duplicates integer not null default 0,   -- the same event delivered again
  signature text not null default 'unchecked' check (signature in ('valid', 'invalid', 'absent', 'unchecked')),
  signature_note text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'ignored', 'unmatched', 'failed', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  processed_at timestamptz
);
create index cdf_lalamove_events_due on public.cdf_lalamove_events (next_attempt_at)
  where status in ('pending', 'processing', 'failed');
create index cdf_lalamove_events_order on public.cdf_lalamove_events (ll_order_id);

-- 2) Each rider booking (Lalamove order) an order has had, including those Lalamove replaced
create table public.cdf_lalamove_shipments (
  ll_order_id text primary key,
  order_id uuid not null references public.cdf_orders(id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  status text,
  replaced_from text,                      -- the booking this one replaced (ORDER_REPLACED)
  replaced_by text,
  replace_noticed_at timestamptz,          -- Lalamove said it replaced it; the new one is not linked yet
  booked_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cdf_lalamove_shipments_order on public.cdf_lalamove_shipments (order_id);
create trigger cdf_lalamove_shipments_touch before update on public.cdf_lalamove_shipments
  for each row execute function public.cdf_touch();

-- 3) Proofs. One row per booking, kind and stop. The file itself goes to the private bucket below.
create table public.cdf_lalamove_proofs (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cdf_orders(id) on delete cascade,
  ll_order_id text not null references public.cdf_lalamove_shipments(ll_order_id) on delete cascade,
  kind text not null check (kind in ('pod', 'pop')),     -- delivery / pickup
  stop_key text not null,
  provider_status text,                    -- as Lalamove says it (PENDING, DELIVERED, SIGNED, FAILED…)
  provider_at timestamptz,
  source_url text,                         -- where Lalamove has it; never shown to the browser
  state text not null default 'pending'
    check (state in ('pending', 'available', 'not_provided', 'error', 'removed')),
  storage_path text, content_type text, bytes integer, sha256 text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error text,
  fetched_at timestamptz,
  removed_at timestamptz, removed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ll_order_id, kind, stop_key)
);
create index cdf_lalamove_proofs_order on public.cdf_lalamove_proofs (order_id);
create trigger cdf_lalamove_proofs_touch before update on public.cdf_lalamove_proofs
  for each row execute function public.cdf_touch();

-- Who reads what: events only admins; history and proofs admins and the order's florist (as cdf_lalamove,
-- migrations 029 and 032). Nobody writes from the browser. The proof's source link stays server-side.
alter table public.cdf_lalamove_events enable row level security;
alter table public.cdf_lalamove_shipments enable row level security;
alter table public.cdf_lalamove_proofs enable row level security;
revoke all on public.cdf_lalamove_events, public.cdf_lalamove_shipments, public.cdf_lalamove_proofs from anon, authenticated;
grant select on public.cdf_lalamove_events, public.cdf_lalamove_shipments to authenticated;
grant select (id, order_id, ll_order_id, kind, stop_key, provider_status, provider_at, state, storage_path,
  content_type, bytes, sha256, error, fetched_at, removed_at, created_at, updated_at) on public.cdf_lalamove_proofs to authenticated;

create function public.cdf_sees_lalamove(p_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.cdf_is_admin(), false) or exists (
    select 1 from public.cdf_orders o where o.id = p_order and o.vendor_email = lower(coalesce(auth.jwt()->>'email', '')))
$$;
create policy cdf_lalamove_events_admin_read on public.cdf_lalamove_events for select to authenticated
  using ((select public.cdf_is_admin()));
create policy cdf_lalamove_shipments_read on public.cdf_lalamove_shipments for select to authenticated
  using (public.cdf_sees_lalamove(order_id));
create policy cdf_lalamove_proofs_read on public.cdf_lalamove_proofs for select to authenticated
  using (public.cdf_sees_lalamove(order_id));

-- 4) The proofs' bucket: private, images only, 10 MiB each. Reading = a short-lived signed link, for a
--    proof that is available, to the same people who see the row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-lalamove-proofs', 'cdf-lalamove-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create function public.cdf_can_read_lalamove_proof(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cdf_lalamove_proofs p
    where p.storage_path = p_name and p.state = 'available' and public.cdf_sees_lalamove(p.order_id))
$$;
create policy cdf_lalamove_proofs_file_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-lalamove-proofs' and (select public.cdf_can_read_lalamove_proof(name)));

-- 5) The history follows cdf_lalamove: every booking it records (and its status) lands in shipments.
--    The function's existing code needs no change for this.
create function public.cdf_lalamove_track() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ll_order_id is null then return new; end if;
  insert into public.cdf_lalamove_shipments as s (ll_order_id, order_id, env, status, booked_at)
  values (new.ll_order_id, new.order_id, new.env, new.status, new.booked_at)
  on conflict (ll_order_id) do update set status = excluded.status,
    booked_at = coalesce(s.booked_at, excluded.booked_at)
  where s.order_id = excluded.order_id;
  return new;
end $$;
create trigger cdf_lalamove_track after insert or update of ll_order_id, status on public.cdf_lalamove
  for each row execute function public.cdf_lalamove_track();
-- What is already booked today becomes the first entry of its history
insert into public.cdf_lalamove_shipments (ll_order_id, order_id, env, status, booked_at)
select ll_order_id, order_id, env, status, booked_at from public.cdf_lalamove where ll_order_id is not null
on conflict (ll_order_id) do nothing;

-- 6) Receiving: store, or count a repeat. The caller answers Lalamove only after this returned.
create function public.cdf_ll_event_receive(p_env text, p_key text, p_type text, p_ll text, p_at timestamptz,
  p_signature text, p_note text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_key, '') = '' or p_payload is null then raise exception 'cdf_invalid_event'; end if;
  insert into public.cdf_lalamove_events (env, event_key, event_type, ll_order_id, event_at, signature, signature_note, payload, status)
  values (p_env, p_key, left(coalesce(nullif(p_type, ''), 'UNKNOWN'), 60), left(p_ll, 40), p_at,
          coalesce(p_signature, 'unchecked'), left(p_note, 300), p_payload,
          case when p_type = 'WALLET_BALANCE_CHANGED' then 'ignored' else 'pending' end)
  on conflict (event_key) do nothing
  returning id into v_id;
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicate', false); end if;
  update public.cdf_lalamove_events set duplicates = duplicates + 1 where event_key = p_key returning id into v_id;
  return jsonb_build_object('id', v_id, 'duplicate', true);
end $$;

-- Take events to work on: due ones (or one given id), oldest first, each by one worker only. A worker
-- that dies leaves its events locked for two minutes, then they are due again.
create function public.cdf_ll_events_claim(p_limit integer, p_id bigint default null)
returns setof public.cdf_lalamove_events
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_events e
  set status = 'processing', attempts = e.attempts + 1, locked_until = now() + interval '2 minutes'
  where e.id in (
    select id from public.cdf_lalamove_events
    where (p_id is null or id = p_id)
      and ((status in ('pending', 'failed') and next_attempt_at <= now()) or (status = 'processing' and locked_until < now()))
    order by coalesce(event_at, received_at), id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked)
  returning e.*
$$;

-- Done with an event. "failed" is tried again later (1, 2, 4… minutes, an hour at most); after 8 tries it
-- is "dead" and stays for someone to look at.
create function public.cdf_ll_event_finish(p_id bigint, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('done', 'ignored', 'unmatched', 'failed') then raise exception 'cdf_invalid_status'; end if;
  update public.cdf_lalamove_events set
    status = case when p_status = 'failed' and attempts >= 8 then 'dead' else p_status end,
    next_attempt_at = case when p_status = 'failed' then now() + least(power(2, greatest(attempts - 1, 0)), 60) * interval '1 minute' else next_attempt_at end,
    locked_until = null, last_error = left(p_error, 500),
    processed_at = case when p_status = 'failed' then processed_at else now() end
  where id = p_id and status = 'processing';
end $$;

-- 7) Bookings
-- Which order a Lalamove order belongs to, and whether it is the one the order follows now
create function public.cdf_ll_shipment(p_ll text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('order_id', s.order_id, 'env', s.env, 'status', s.status, 'replaced_by', s.replaced_by,
    'current', exists (select 1 from public.cdf_lalamove l where l.order_id = s.order_id and l.ll_order_id = s.ll_order_id))
  from public.cdf_lalamove_shipments s where s.ll_order_id = p_ll
$$;

-- Lalamove said it replaced this booking (ORDER_REPLACED); the new one is linked when it shows up
create function public.cdf_ll_replace_noticed(p_ll text) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_shipments set replace_noticed_at = coalesce(replace_noticed_at, now()) where ll_order_id = p_ll
$$;

-- A Lalamove order we don't know, which Lalamove itself (GET /v3/orders, our metadata.cdfOrder) says
-- belongs to order number p_num: it replaces that order's booking, which the order follows from now on.
-- Only when the order's current booking is in the same environment and is not already this one.
create function public.cdf_ll_link_replacement(p_num text, p_new text, p_env text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_order uuid; v_old text;
begin
  if coalesce(p_new, '') = '' or exists (select 1 from public.cdf_lalamove_shipments where ll_order_id = p_new) then return null; end if;
  select l.order_id, l.ll_order_id into v_order, v_old
  from public.cdf_lalamove l join public.cdf_orders o on o.id = l.order_id
  where o.num::text = p_num and l.env = p_env and l.ll_order_id is not null and l.ll_order_id <> p_new
  for update of l;
  if v_order is null then return null; end if;
  insert into public.cdf_lalamove_shipments (ll_order_id, order_id, env, replaced_from, booked_at)
  values (p_new, v_order, p_env, v_old, now());
  update public.cdf_lalamove_shipments set replaced_by = p_new, replace_noticed_at = coalesce(replace_noticed_at, now())
  where ll_order_id = v_old;
  update public.cdf_lalamove set ll_order_id = p_new, error = null, cancelled_by_us = false where order_id = v_order;
  return v_order;
end $$;

-- Bookings to read back from Lalamove even when no webhook came: still running (last 3 days), or
-- finished in the last 2 days without a delivery proof row yet. Each at most every 4 minutes.
create function public.cdf_ll_reconcile_due(p_limit integer) returns setof text
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_shipments s set last_checked_at = now()
  where s.ll_order_id in (
    select s2.ll_order_id from public.cdf_lalamove_shipments s2
    join public.cdf_lalamove l on l.ll_order_id = s2.ll_order_id
    where (s2.last_checked_at is null or s2.last_checked_at < now() - interval '4 minutes')
      and ((coalesce(s2.status, '') not in ('COMPLETED', 'CANCELED', 'REJECTED', 'EXPIRED') and coalesce(s2.booked_at, s2.created_at) > now() - interval '3 days')
        or (s2.status = 'COMPLETED' and s2.updated_at > now() - interval '2 days'
            and not exists (select 1 from public.cdf_lalamove_proofs p where p.ll_order_id = s2.ll_order_id and p.kind = 'pod')))
    order by s2.last_checked_at nulls first
    limit greatest(1, least(coalesce(p_limit, 10), 30))
    for update of s2 skip locked)
  returning s.ll_order_id
$$;

-- 8) Proofs
-- What Lalamove now says about a proof. Returns { id, fetch }: fetch = the file should be downloaded now.
-- A proof already kept (or removed by the office) is never downloaded again: image links may change on
-- every read, and the kept copy is what counts.
create function public.cdf_ll_proof_note(p_ll text, p_kind text, p_stop text, p_status text, p_at timestamptz, p_url text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_order uuid; v_row public.cdf_lalamove_proofs%rowtype; v_url text; v_state text;
begin
  select order_id into v_order from public.cdf_lalamove_shipments where ll_order_id = p_ll;
  if v_order is null then raise exception 'cdf_unknown_shipment'; end if;
  if p_kind not in ('pod', 'pop') or coalesce(p_stop, '') = '' then raise exception 'cdf_invalid_proof'; end if;
  v_url := case when p_url ~* '^https://[^\s]+$' then left(p_url, 2000) end;
  v_state := case
    when upper(coalesce(p_status, '')) = 'FAILED' then 'not_provided'
    when v_url is not null then 'pending'
    when upper(coalesce(p_status, '')) in ('DELIVERED', 'SIGNED') then 'not_provided'
    else 'pending' end;
  insert into public.cdf_lalamove_proofs (order_id, ll_order_id, kind, stop_key, provider_status, provider_at, source_url, state)
  values (v_order, p_ll, p_kind, left(p_stop, 60), left(upper(p_status), 30), p_at, v_url, v_state)
  on conflict (ll_order_id, kind, stop_key) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.cdf_lalamove_proofs where ll_order_id = p_ll and kind = p_kind and stop_key = left(p_stop, 60) for update;
    if v_row.state in ('available', 'removed') then
      update public.cdf_lalamove_proofs set provider_status = coalesce(left(upper(p_status), 30), provider_status),
        provider_at = coalesce(p_at, provider_at) where id = v_row.id;
      return jsonb_build_object('id', v_row.id, 'fetch', false);
    end if;
    update public.cdf_lalamove_proofs set
      provider_status = coalesce(left(upper(p_status), 30), provider_status), provider_at = coalesce(p_at, provider_at),
      source_url = coalesce(v_url, source_url),
      -- a new link after giving up: try again from zero
      attempts = case when v_url is distinct from source_url and v_url is not null then 0 else attempts end,
      next_attempt_at = case when v_url is distinct from source_url and v_url is not null then now() else next_attempt_at end,
      state = case
        when v_state = 'pending' and v_url is null and source_url is not null then state   -- keep what we have
        when state = 'error' and (v_url is null or v_url = source_url) then 'error'
        else v_state end,
      error = case when v_url is distinct from source_url and v_url is not null then null else error end
    where id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id,
    'fetch', v_row.state = 'pending' and v_row.source_url is not null and v_row.attempts < 5 and v_row.next_attempt_at <= now());
end $$;

-- Proofs waiting to be downloaded (claimed for five minutes so two workers don't fetch the same one)
create function public.cdf_ll_proofs_due(p_limit integer, p_id bigint default null)
returns table (id bigint, order_id uuid, ll_order_id text, kind text, stop_key text, source_url text, attempts integer)
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_proofs p set next_attempt_at = now() + interval '5 minutes'
  where p.id in (select id from public.cdf_lalamove_proofs
    where (p_id is null or id = p_id) and state = 'pending' and source_url is not null and attempts < 5 and next_attempt_at <= now()
    order by next_attempt_at limit greatest(1, least(coalesce(p_limit, 5), 20)) for update skip locked)
  returning p.id, p.order_id, p.ll_order_id, p.kind, p.stop_key, p.source_url, p.attempts
$$;

create function public.cdf_ll_proof_stored(p_id bigint, p_path text, p_type text, p_bytes integer, p_sha text) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_proofs set state = 'available', storage_path = p_path, content_type = p_type,
    bytes = p_bytes, sha256 = p_sha, fetched_at = now(), error = null, attempts = attempts + 1
  where id = p_id and state = 'pending'
$$;

-- A download that did not work. p_final (not an image, too big, a host we don't accept): no more tries.
-- Otherwise 2, 4, 8, 16 minutes, then "error" after the fifth.
create function public.cdf_ll_proof_failed(p_id bigint, p_error text, p_final boolean default false) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_proofs set attempts = attempts + 1, error = left(p_error, 300),
    state = case when p_final or attempts + 1 >= 5 then 'error' else state end,
    next_attempt_at = now() + power(2, attempts + 1) * interval '1 minute'
  where id = p_id and state = 'pending'
$$;

-- The office took a proof out (the file is deleted by the function first)
create function public.cdf_ll_proof_removed(p_id bigint, p_by text) returns text
language sql security definer set search_path = '' as $$
  update public.cdf_lalamove_proofs set state = 'removed', storage_path = null, removed_at = now(), removed_by = lower(p_by)
  where id = p_id returning order_id::text
$$;

-- 9) The worker: the cdf-lalamove function, called every five minutes where pg_cron exists, with the same
--    shared secret as cdf-push (vault cdf_hook_secret). It handles due events, reads back running bookings
--    and downloads due proofs.
create function public.cdf_lalamove_work_hook() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-lalamove',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := jsonb_build_object('action', 'work'));
end $$;

-- Events kept 90 days once handled (failed and dead ones stay until someone looks)
create function public.cdf_ll_events_prune() returns integer
language sql security definer set search_path = '' as $$
  with gone as (delete from public.cdf_lalamove_events
    where status in ('done', 'ignored') and received_at < now() - interval '90 days' returning 1)
  select count(*)::integer from gone
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.cdf_lalamove_track()', 'public.cdf_ll_event_receive(text, text, text, text, timestamptz, text, text, jsonb)',
    'public.cdf_ll_events_claim(integer, bigint)', 'public.cdf_ll_event_finish(bigint, text, text)',
    'public.cdf_ll_shipment(text)', 'public.cdf_ll_replace_noticed(text)', 'public.cdf_ll_link_replacement(text, text, text)',
    'public.cdf_ll_reconcile_due(integer)', 'public.cdf_ll_proof_note(text, text, text, text, timestamptz, text)',
    'public.cdf_ll_proofs_due(integer, bigint)', 'public.cdf_ll_proof_stored(bigint, text, text, integer, text)',
    'public.cdf_ll_proof_failed(bigint, text, boolean)', 'public.cdf_ll_proof_removed(bigint, text)',
    'public.cdf_lalamove_work_hook()', 'public.cdf_ll_events_prune()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach fn in array array['public.cdf_sees_lalamove(uuid)', 'public.cdf_can_read_lalamove_proof(text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- Live in the panel: a proof that arrives shows up without reloading
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cdf_lalamove_proofs;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cdf-lalamove-work', '*/5 * * * *', 'select public.cdf_lalamove_work_hook()');
  end if;
end $$;
