-- A reference photo can replace the description; ready files remain session-checked.
alter table public.cdf_order_requests drop constraint cdf_order_requests_description_check;
alter table public.cdf_order_requests add constraint cdf_order_requests_description_check
  check (length(description) between 0 and 1000);

create or replace function public.cdf_request_submit(p_token_hash text, p_ip_hash text, p_request jsonb) returns jsonb
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
  v_branch text := nullif(btrim(p_request->>'pickup_branch'), '');
begin
  if p_token_hash is null or p_request is null or jsonb_typeof(p_request) <> 'object' then raise exception 'cdf_invalid_request'; end if;
  begin v_key := (p_request->>'request_key')::uuid; exception when others then raise exception 'cdf_invalid_request'; end;
  if v_key is null then raise exception 'cdf_invalid_request'; end if;
  v_fingerprint := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');

  select id into v_session from public.cdf_upload_sessions
  where token_hash = p_token_hash and expires_at > now() and submitted_at is null for update;
  select * into v_found from public.cdf_order_requests where request_key = v_key;
  if found then
    if v_found.fingerprint <> v_fingerprint
      or not exists (select 1 from public.cdf_upload_sessions s where s.id = v_found.session_id and s.token_hash = p_token_hash) then
      raise exception 'cdf_operation_conflict';
    end if;
    return jsonb_build_object('id', v_found.id, 'ref', v_found.ref, 'replayed', true);
  end if;
  if v_session is null then raise exception 'cdf_session_invalid'; end if;

  if (p_request->>'date')::date < v_today or (p_request->>'date')::date > v_today + 90 then raise exception 'cdf_invalid_request'; end if;

  -- A pickup's shop is there and open that day; a delivery names none. A pickup without a shop is still
  -- accepted here, as the form published before this change sends it (the new form's function requires one).
  if p_request->>'mode' = 'pickup' then
    if v_branch is not null and not exists (select 1 from jsonb_array_elements(public.cdf_pickup_shops((p_request->>'date')::date)) s
        where s->>'branch' = v_branch and (s->>'available')::boolean) then
      raise exception 'cdf_pickup_shop';
    end if;
  elsif v_branch is not null then raise exception 'cdf_invalid_request';
  end if;

  v_refs := array(select (jsonb_array_elements_text(coalesce(p_request->'reference_files', '[]'::jsonb)))::uuid);
  v_proof := nullif(p_request->>'payment_proof', '')::uuid;
  if cardinality(v_refs) > 6
    or cardinality(v_refs) <> (select count(distinct f.id) from public.cdf_request_files f
      where f.session_id = v_session and f.kind = 'reference' and f.status = 'ready' and f.request_id is null and f.id = any (v_refs))
    or (v_proof is not null and not exists (select 1 from public.cdf_request_files f
      where f.session_id = v_session and f.kind = 'payment_proof' and f.status = 'ready' and f.request_id is null and f.id = v_proof)) then
    raise exception 'cdf_request_files';
  end if;

  -- A real reference from this session can replace the written description.
  if length(btrim(coalesce(p_request->>'description', ''))) < 3 and cardinality(v_refs) = 0 then
    raise exception 'cdf_request_description';
  end if;

  insert into public.cdf_order_requests (request_key, session_id, lang, buyer_name, buyer_phone, receiver_name, receiver_phone,
    mode, date, slot, address, lat, lng, location_source, location_confirmed_at, description, special_requests, card_message,
    payment_method, fingerprint, ip_hash, pickup_branch)
  select v_key, v_session, coalesce(r.lang, 'en'), r.buyer_name, r.buyer_phone, r.receiver_name, r.receiver_phone,
    r.mode, r.date, r.slot, coalesce(r.address, ''), r.lat, r.lng, r.location_source, r.location_confirmed_at, r.description,
    coalesce(r.special_requests, ''), coalesce(r.card_message, ''), r.payment_method, v_fingerprint, p_ip_hash, v_branch
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
