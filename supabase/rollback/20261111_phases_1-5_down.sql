-- Phase 6: undo Phases 1–5 in the database, if they ever have to come out after being applied.
-- NOT run by anything. Only after approval, and only after the web and the functions were rolled back
-- first (an app still calling these functions would fail). Tested in tests/production-parity.cjs: after
-- it the database is what production is today (11/11/2026), except the two buckets below.
-- DELETES what Phases 1–5 stored (requests, uploaded files' rows, Lalamove events and proofs rows).
-- Export them first if they matter. Orders, prices and payments created meanwhile are kept: they live in
-- the existing tables.
-- The buckets cdf-solicitudes and cdf-lalamove-proofs are left: empty them and delete them from the
-- Supabase dashboard (Storage), which removes their files too.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('cdf-outbox-retry', 'cdf-lalamove-work', 'cdf-requests-cleanup');
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cdf_lalamove_proofs') then
    alter publication supabase_realtime drop table public.cdf_lalamove_proofs; end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cdf_order_requests') then
    alter publication supabase_realtime drop table public.cdf_order_requests; end if;
end $$;
drop policy if exists cdf_lalamove_proofs_file_read on storage.objects;
drop policy if exists cdf_solicitudes_read on storage.objects;
drop trigger if exists cdf_lalamove_track on public.cdf_lalamove;

-- 12/11/2026 trash: first restore or decide every order still in the trash (rolling back makes them visible again,
-- since the column goes). The log (cdf_order_audit) is dropped too: export it first if it matters.
drop trigger if exists cdf_orders_hard_delete_guard on public.cdf_orders;
drop trigger if exists cdf_orders_trash_guard on public.cdf_orders;
drop trigger if exists cdf_members_owner_guard on public.cdf_members;
drop trigger if exists cdf_order_requests_keep_num on public.cdf_order_requests;
drop function if exists public.cdf_request_counts();
drop function if exists public.cdf_request_order(uuid);
drop function if exists public.cdf_request_keep_num();
drop function if exists public.cdf_order_purge(uuid, text);
drop function if exists public.cdf_order_restore(uuid);
drop function if exists public.cdf_order_trash(uuid, text);
drop function if exists public.cdf_order_rider_on(uuid);
drop function if exists public.cdf_guard_hard_delete();
drop function if exists public.cdf_guard_trash();
drop function if exists public.cdf_is_owner();
drop function if exists public.cdf_guard_owner();
drop table if exists public.cdf_order_audit;
delete from public.cdf_order_events where kind in ('trashed', 'untrashed');
alter table public.cdf_order_events drop constraint cdf_order_events_kind_check;
alter table public.cdf_order_events add constraint cdf_order_events_kind_check
  check (kind in ('created', 'updated', 'status', 'rescheduled', 'archived', 'restored', 'cancelled', 'reinstated'));
create or replace function public.cdf_log_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_by text := nullif(lower(coalesce(auth.jwt()->>'email', '')), '');
  v_changes jsonb := '{}'::jsonb;
  v_kind text;
  k text;
  v_old jsonb; v_new jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.cdf_order_events (order_id, by_email, kind, changes)
    values (new.id, v_by, 'created', jsonb_build_object('num', new.num, 'date', new.date, 'slot', new.slot));
    return new;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach k in array array['num', 'date', 'slot', 'channel', 'vendor_email', 'carrier_email', 'customer_name', 'customer_phone',
    'customer_email', 'buyer_name', 'buyer_phone', 'address', 'card_message', 'notes', 'delivery_note', 'status', 'delivery'] loop
    if v_new ? k and (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k, v_new->k));
    end if;
  end loop;
  foreach k in array array['photo_path', 'bouquet_path', 'proof_path'] loop
    if (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k is not null and v_old->>k <> '', v_new->k is not null and v_new->>k <> ''));
    end if;
  end loop;

  if old.cancelled_at is null and new.cancelled_at is not null then
    v_kind := 'cancelled'; v_changes := v_changes || jsonb_build_object('cancel_reason', jsonb_build_array(null, new.cancel_reason));
  elsif old.cancelled_at is not null and new.cancelled_at is null then
    v_kind := 'reinstated'; v_changes := v_changes || jsonb_build_object('cancel_reason', jsonb_build_array(old.cancel_reason, null));
  elsif old.archived_at is null and new.archived_at is not null then v_kind := 'archived';
  elsif old.archived_at is not null and new.archived_at is null then v_kind := 'restored';
  elsif new.attempts > old.attempts then v_kind := 'rescheduled';
  elsif v_changes ? 'status' or v_changes ? 'delivery' then v_kind := 'status';
  elsif v_changes = '{}'::jsonb then return new;
  else v_kind := 'updated';
  end if;

  insert into public.cdf_order_events (order_id, by_email, kind, changes) values (new.id, v_by, v_kind, v_changes);
  return new;
end $$;
alter table public.cdf_orders drop constraint if exists cdf_orders_trash_shape;
drop index if exists public.cdf_orders_trash;
alter table public.cdf_orders drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists delete_reason;
alter table public.cdf_members drop column if exists is_owner;

-- 12/11/2026 booking guard (audit F01/F02): the delete guard and the booking functions go, then the columns.
-- Check first that no order has booking_state 'uncertain' (it would be forgotten).
drop trigger if exists cdf_orders_guard_delete on public.cdf_orders;
drop function if exists public.cdf_guard_order_delete();
drop function if exists public.cdf_ll_quote_store(uuid, text, jsonb);
drop function if exists public.cdf_ll_link_attempt(uuid, text, text);
drop function if exists public.cdf_ll_book_resolve(uuid, text, text, text, text, numeric);
drop function if exists public.cdf_ll_book_failed(uuid, uuid, boolean, text);
drop function if exists public.cdf_ll_book_done(uuid, uuid, text, text, text, numeric);
drop function if exists public.cdf_ll_book_claim(uuid, uuid, text);
drop function if exists public.cdf_ll_settle_stale(public.cdf_lalamove);
drop function if exists public.cdf_ll_final(text);
alter table public.cdf_lalamove drop constraint if exists cdf_lalamove_booking_pair;
alter table public.cdf_lalamove drop column if exists booking_key, drop column if exists booking_state,
  drop column if exists booking_started_at, drop column if exists booking_by;

-- 12/11/2026 pickup orders: cdf_progress back to production's version, then the column and functions go.
-- Pickup orders made meanwhile stay as orders (as deliveries without an address).
create or replace function public.cdf_progress(p_id uuid, p_step text, p_note text default null, p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare
  r public.cdf_orders;
  v_role text := public.cdf_my_role();
  v_me text := lower(coalesce(auth.jwt()->>'email', ''));
  v_status text; v_delivery text;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.cdf_is_staff() and (r.archived_at is not null
    or (public.cdf_my_role()='carrier' and r.carrier_email is not null and r.carrier_email<>lower(coalesce(auth.jwt()->>'email','')))
    or (public.cdf_my_role()='vendor' and r.vendor_email is distinct from lower(coalesce(auth.jwt()->>'email','')))) then
    raise exception 'order is no longer assigned to this user' using errcode='42501';
  end if;
  case p_step
    when 'prep' then v_status := 'Preparing'; v_delivery := '-';
    when 'ready' then v_status := 'Ready'; v_delivery := '-';
    when 'transit' then v_status := 'Ready'; v_delivery := 'In transit';
    when 'done' then v_status := 'Ready'; v_delivery := 'Delivered';
    when 'fail' then v_status := 'Ready'; v_delivery := 'Failed';
    else raise exception 'bad step' using errcode = '22023';
  end case;
  if v_role = 'carrier' and p_step not in ('transit', 'done', 'fail') then
    raise exception 'carriers can only set In transit, Delivered or Failed' using errcode = '42501';
  end if;
  if not public.cdf_is_staff() and not public.cdf_step_ok(public.cdf_step_of(r.status, r.delivery), p_step) then
    raise exception 'this step does not follow from the current one' using errcode = '22023';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = v_status, delivery = v_delivery,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end,
    carrier_email = case when v_role = 'carrier' and p_step in ('transit', 'done', 'fail') then coalesce(carrier_email, v_me) else carrier_email end
  where id = p_id returning * into r;
  return r;
end $$;
alter table public.cdf_orders drop constraint if exists cdf_orders_pickup_no_transit;
alter table public.cdf_orders drop column if exists pickup;
drop function if exists public.cdf_pickup_step_ok(text, text);
drop function if exists public.cdf_pickup_shops(date);

-- 12/11/2026 additions (request expiry and clean-up). pg_cron itself is left installed: it is harmless
-- and other jobs may use it by then.
drop trigger if exists cdf_members_sees_stats on public.cdf_members;
drop function if exists public.cdf_guard_sees_stats();
alter table public.cdf_members drop column if exists sees_stats;
drop function if exists public.cdf_outbox_sent(bigint, text);
drop function if exists public.cdf_requests_cleanup_hook();
drop function if exists public.cdf_requests_purge(text[]);
drop function if exists public.cdf_requests_purge_list(integer);
drop function if exists public.cdf_requests_purge_claim(integer);
drop function if exists public.cdf_guard_request_purge() cascade;
drop function if exists public.cdf_requests_expire();
drop table if exists public.cdf_lalamove_proofs cascade;
drop table if exists public.cdf_lalamove_shipments cascade;
drop table if exists public.cdf_lalamove_events cascade;
drop table if exists public.cdf_outbox cascade;
drop table if exists public.cdf_request_events cascade;
drop table if exists public.cdf_request_files cascade;
drop table if exists public.cdf_order_requests cascade;
drop table if exists public.cdf_upload_sessions cascade;
drop table if exists public.cdf_rate_limits cascade;
drop table if exists public.cdf_operation_keys cascade;

drop function if exists public.cdf_branch_ranking(numeric, numeric, date);
drop function if exists public.cdf_can_read_lalamove_proof(text);
drop function if exists public.cdf_can_read_request_file(text);
drop function if exists public.cdf_create_order(uuid, jsonb, numeric, jsonb);
drop function if exists public.cdf_lalamove_track();
drop function if exists public.cdf_lalamove_work_hook();
drop function if exists public.cdf_ll_event_finish(bigint, text, text);
drop function if exists public.cdf_ll_event_receive(text, text, text, text, timestamp with time zone, text, text, jsonb);
drop function if exists public.cdf_ll_events_claim(integer, bigint);
drop function if exists public.cdf_ll_events_prune();
drop function if exists public.cdf_ll_link_replacement(text, text, text);
drop function if exists public.cdf_ll_proof_failed(bigint, text, boolean);
drop function if exists public.cdf_ll_proof_note(text, text, text, text, timestamp with time zone, text);
drop function if exists public.cdf_ll_proof_removed(bigint, text);
drop function if exists public.cdf_ll_proof_stored(bigint, text, text, integer, text);
drop function if exists public.cdf_ll_proofs_due(integer, bigint);
drop function if exists public.cdf_ll_reconcile_due(integer);
drop function if exists public.cdf_ll_replace_noticed(text);
drop function if exists public.cdf_ll_shipment(text);
drop function if exists public.cdf_order_references(uuid);
drop function if exists public.cdf_outbox_done(bigint);
drop function if exists public.cdf_outbox_retry();
drop function if exists public.cdf_outbox_send(bigint);
drop function if exists public.cdf_rate_hit(text, integer, integer);
drop function if exists public.cdf_request_accept(uuid, uuid, jsonb, numeric, jsonb);
drop function if exists public.cdf_request_admin();
drop function if exists public.cdf_request_announce();
drop function if exists public.cdf_request_open(uuid);
drop function if exists public.cdf_request_reject(uuid, text);
drop function if exists public.cdf_request_reopen(uuid);
drop function if exists public.cdf_request_similar(uuid);
drop function if exists public.cdf_request_submit(text, text, jsonb);
drop function if exists public.cdf_sees_lalamove(uuid);
drop function if exists public.cdf_upload_claim(text, text, text);
drop function if exists public.cdf_upload_files_ready(text, uuid[], uuid);
drop function if exists public.cdf_upload_finish(text, uuid, text, text, integer, integer, integer, text);
drop function if exists public.cdf_upload_session_of(text);
drop function if exists public.cdf_upload_session_open(text, text);
drop function if exists public.cdf_record_payment(uuid, uuid, numeric, text[], numeric, numeric, uuid, text, text, text, date);

-- The 8-argument payment function as production has it today (migration 20261109120000)
create or replace function public.cdf_record_payment(
  p_order uuid, p_request uuid, p_amount numeric, p_proofs text[],
  p_price numeric, p_seen_price numeric, p_reverses uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_price public.cdf_order_prices%rowtype;
  v_entry jsonb;
  v_delta numeric;
  v_total numeric;
  v_actor text := lower(auth.jwt()->>'email');
begin
  if auth.uid() is null or v_actor is null or not coalesce(public.cdf_is_admin(), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_request is null then raise exception 'cdf_invalid_payment'; end if;
  insert into public.cdf_order_prices(order_id) values (p_order) on conflict (order_id) do nothing;
  select * into strict v_price from public.cdf_order_prices where order_id = p_order for update;

  if not exists (select 1 from jsonb_array_elements(v_price.payment_history) e where e->>'id' = p_request::text) then
    v_total := v_price.amount;
    if p_reverses is null then
      if v_price.amount is distinct from p_seen_price then raise exception 'cdf_price_changed'; end if;
      v_total := p_price;
      if p_amount is null or not (p_amount > 0 and p_amount = round(p_amount, 2))
        or not coalesce(v_total between 0 and 99999999.99 and v_total = round(v_total, 2), false) then
        raise exception 'cdf_invalid_payment';
      end if;
      v_delta := p_amount;
      if coalesce(v_price.paid, 0) + v_delta > v_total then raise exception 'cdf_payment_above_due'; end if;
      if coalesce(cardinality(p_proofs), 0) > 12 or exists (
        select 1 from unnest(p_proofs) as path
        where path is null or split_part(path, '/', 1) <> p_order::text
          or not exists (select 1 from storage.objects where bucket_id = 'cdf-pagos' and name = path)
      ) then raise exception 'cdf_invalid_payment_proofs'; end if;
    else
      select e into v_entry from jsonb_array_elements(v_price.payment_history) e
      where e->>'id' = p_reverses::text and (e->>'amount')::numeric > 0;
      if v_entry is null or nullif(btrim(p_reason), '') is null or length(p_reason) > 500
        or exists (select 1 from jsonb_array_elements(v_price.payment_history) e where e->>'reverses' = p_reverses::text)
      then raise exception 'cdf_invalid_correction'; end if;
      v_delta := -(v_entry->>'amount')::numeric;
      p_proofs := '{}';
    end if;

    v_entry := jsonb_build_object(
      'id', p_request, 'kind', case when p_reverses is null then 'payment' else 'reversal' end,
      'amount', v_delta, 'created_at', clock_timestamp(), 'by_email', v_actor,
      'proofs', coalesce(p_proofs, '{}'), 'reverses', p_reverses, 'reason', nullif(btrim(p_reason), '')
    );
    update public.cdf_order_prices
    set amount = v_total, paid = coalesce(v_price.paid, 0) + v_delta,
        payment_history = payment_history || jsonb_build_array(v_entry)
    where order_id = p_order returning * into v_price;
  end if;
  return to_jsonb(v_price);
end $$;

revoke all on function public.cdf_record_payment(uuid, uuid, numeric, text[], numeric, numeric, uuid, text) from public, anon;
grant execute on function public.cdf_record_payment(uuid, uuid, numeric, text[], numeric, numeric, uuid, text) to authenticated;
commit;
