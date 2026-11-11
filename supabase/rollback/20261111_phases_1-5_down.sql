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

-- 12/11/2026 additions (request expiry and clean-up). pg_cron itself is left installed: it is harmless
-- and other jobs may use it by then.
drop function if exists public.cdf_requests_cleanup_hook();
drop function if exists public.cdf_requests_purge(text[]);
drop function if exists public.cdf_requests_purge_list(integer);
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
