-- 12/11/2026 (rider photo diagnosis). A proof link that came in a webhook event is kept even when reading the
-- booking back later says "delivered" without the picture: before, that second read turned the proof into
-- "not provided" and the link was never fetched. The links themselves are made https (only for Lalamove's
-- proof hosts) by cdf-lalamove before they get here; this function still accepts https links only.
-- Replaces one function; nothing else changes.
create or replace function public.cdf_ll_proof_note(p_ll text, p_kind text, p_stop text, p_status text, p_at timestamptz, p_url text)
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
        when v_url is null and source_url is not null then state   -- keep the link we have, whatever a later read says
        when state = 'error' and (v_url is null or v_url = source_url) then 'error'
        else v_state end,
      error = case when v_url is distinct from source_url and v_url is not null then null else error end
    where id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id,
    'fetch', v_row.state = 'pending' and v_row.source_url is not null and v_row.attempts < 5 and v_row.next_attempt_at <= now());
end $$;
revoke all on function public.cdf_ll_proof_note(text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.cdf_ll_proof_note(text, text, text, text, timestamptz, text) to service_role;
