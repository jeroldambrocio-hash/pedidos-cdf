-- Reuse the existing request identity as the sequence for requests and manual orders.
-- Begin above both histories, including audited deletions, without changing existing references.
begin;
lock table public.cdf_order_requests, public.cdf_orders in access exclusive mode;

alter table public.cdf_order_requests add column shared_number boolean not null default false;
alter table public.cdf_order_requests alter column shared_number set default true;

do $$
declare
  v_next bigint;
begin
  select greatest(
    (select last_value + is_called::int from public.cdf_order_requests_ref_seq),
    coalesce((select max(ref) + 1 from public.cdf_order_requests), 1),
    coalesce((select max(num::bigint) + 1 from public.cdf_orders where num ~ '^[0-9]+$'), 1),
    coalesce((select max(order_num::bigint) + 1 from public.cdf_order_audit where order_num ~ '^[0-9]+$'), 1),
    coalesce((select max(accepted_order_num::bigint) + 1 from public.cdf_order_requests where accepted_order_num ~ '^[0-9]+$'), 1)
  ) into v_next;
  execute format('alter sequence public.cdf_order_requests_ref_seq restart with %s', v_next);
end $$;

create schema cdf_numbering;
revoke all on schema cdf_numbering from public, anon, authenticated, service_role;
revoke all on sequence public.cdf_order_requests_ref_seq from public, anon, authenticated, service_role;
-- Moderators can insert directly under the existing staff RLS policy.
grant usage on sequence public.cdf_order_requests_ref_seq to authenticated;

create function cdf_numbering.format_number(p_num bigint) returns text
language sql immutable strict set search_path = '' as $$
  select lpad(p_num::text, greatest(4, length(p_num::text)), '0')
$$;

create function cdf_numbering.assign_order_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.num is distinct from old.num then raise exception 'cdf_order_number_immutable'; end if;
  elsif new.num is null or current_user = 'authenticated' then
    new.num := nextval('public.cdf_order_requests_ref_seq'::regclass)::text;
    new.num := lpad(new.num, greatest(4, length(new.num)), '0');
  end if;
  return new;
end $$;

create trigger cdf_orders_assign_number before insert or update of num on public.cdf_orders
for each row execute function cdf_numbering.assign_order_number();

create function cdf_numbering.create_order(p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb, p_reserved bigint)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_actor text := lower(auth.jwt()->>'email');
  v_fields constant text[] := array['id', 'num', 'date', 'slot', 'channel', 'notes', 'vendor_email', 'carrier_email',
    'customer_name', 'address', 'delivery_note', 'customer_phone', 'customer_email', 'buyer_name', 'buyer_phone',
    'card_message', 'drop_lat', 'drop_lng', 'vehicle', 'pickup'];
  v_pay_fields constant text[] := array['amount', 'method', 'reference', 'paid_at', 'proofs'];
  v_fingerprint text;
  v_key public.cdf_operation_keys%rowtype;
  v_order public.cdf_orders%rowtype;
  v_amount numeric;
  v_paid_at date;
  v_proofs text[];
  v_rows integer;
begin
  if auth.uid() is null or v_actor is null or not coalesce(public.cdf_is_admin(), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_request is null and p_order is null and p_price is null and p_payment is null then
    return jsonb_build_object('available', true);
  end if;
  if p_request is null or p_order is null or jsonb_typeof(p_order) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_order) k where k <> all (v_fields))
    or (p_order ? 'pickup' and jsonb_typeof(p_order->'pickup') <> 'boolean') then
    raise exception 'cdf_invalid_order';
  end if;
  if p_price is not null and not (p_price between 0 and 99999999.99 and p_price = round(p_price, 2)) then
    raise exception 'cdf_invalid_payment';
  end if;
  if p_payment is not null then
    if jsonb_typeof(p_payment) <> 'object' or p_price is null
      or exists (select 1 from jsonb_object_keys(p_payment) k where k <> all (v_pay_fields))
      or jsonb_typeof(p_payment->'amount') is distinct from 'number'
      or nullif(btrim(p_payment->>'method'), '') is null
      or coalesce(p_payment->>'paid_at', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(coalesce(p_payment->'proofs', '[]'::jsonb)) <> 'array' then
      raise exception 'cdf_invalid_payment';
    end if;
    begin
      v_amount := (p_payment->>'amount')::numeric;
      v_paid_at := (p_payment->>'paid_at')::date;
    exception when others then raise exception 'cdf_invalid_payment';
    end;
    v_proofs := array(select jsonb_array_elements_text(coalesce(p_payment->'proofs', '[]'::jsonb)));
  end if;

  v_fingerprint := encode(sha256(convert_to((jsonb_build_object(
    'order', p_order, 'price', trim_scale(p_price), 'payment', p_payment) ||
    case when p_reserved is null then '{}'::jsonb else jsonb_build_object('reserved', p_reserved) end)::text, 'UTF8')), 'hex');
  insert into public.cdf_operation_keys(key, kind, by_email, fingerprint)
  values (p_request, 'create_order', v_actor, v_fingerprint) on conflict (key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select * into strict v_key from public.cdf_operation_keys where key = p_request;
    if v_key.kind <> 'create_order' or v_key.by_email <> v_actor or v_key.fingerprint <> v_fingerprint then
      raise exception 'cdf_operation_conflict';
    end if;
    select * into v_order from public.cdf_orders where id = v_key.order_id;
    if not found then raise exception 'cdf_operation_gone'; end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'replayed', true,
      'price', (select to_jsonb(p) from public.cdf_order_prices p where p.order_id = v_order.id));
  end if;

  insert into public.cdf_orders (id, num, date, slot, channel, notes, vendor_email, carrier_email, customer_name, address,
    delivery_note, customer_phone, customer_email, buyer_name, buyer_phone, card_message, drop_lat, drop_lng, vehicle, pickup)
  select coalesce(r.id, gen_random_uuid()), cdf_numbering.format_number(p_reserved), r.date, r.slot, r.channel, coalesce(r.notes, ''),
    nullif(r.vendor_email, ''), nullif(r.carrier_email, ''), coalesce(r.customer_name, ''), coalesce(r.address, ''),
    coalesce(r.delivery_note, ''), coalesce(r.customer_phone, ''), coalesce(r.customer_email, ''),
    coalesce(r.buyer_name, ''), coalesce(r.buyer_phone, ''), coalesce(r.card_message, ''), r.drop_lat, r.drop_lng, r.vehicle,
    coalesce(r.pickup, false)
  from jsonb_populate_record(null::public.cdf_orders, p_order) r
  returning * into v_order;

  if p_price is not null then
    insert into public.cdf_order_prices(order_id, amount) values (v_order.id, p_price);
  end if;
  if p_payment is not null then
    perform public.cdf_record_payment(v_order.id, p_request, v_amount, v_proofs, p_price, p_price, null, null,
      p_payment->>'method', p_payment->>'reference', v_paid_at);
  end if;

  update public.cdf_operation_keys set order_id = v_order.id where key = p_request;
  return jsonb_build_object('order', to_jsonb(v_order), 'replayed', false,
    'price', (select to_jsonb(p) from public.cdf_order_prices p where p.order_id = v_order.id));
end $$;

-- The public RPC keeps its existing authorization and idempotency checks.
create or replace function public.cdf_create_order(p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb)
returns jsonb
language sql security definer set search_path = '' as $$
  select case when p_request is null and p_order is null and p_price is null and p_payment is null
    and auth.uid() is not null and public.cdf_is_staff()
    then jsonb_build_object('available', true, 'shared_numbers', true)
    else cdf_numbering.create_order(p_request, p_order, p_price, p_payment, null)
  end
$$;

create or replace function public.cdf_request_accept(p_id uuid, p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := public.cdf_request_admin();
  v_row public.cdf_order_requests%rowtype;
  v_made jsonb;
  v_order uuid;
  v_reserved bigint;
begin
  select * into v_row from public.cdf_order_requests where id = p_id for update;
  if not found then raise exception 'cdf_request_gone'; end if;
  if v_row.shared_number then
    v_reserved := v_row.ref;
    if jsonb_typeof(p_order) = 'object' then p_order := p_order - 'num'; end if;
  end if;
  if v_row.status = 'accepted' then
    if v_row.accepted_key is distinct from p_request then raise exception 'cdf_request_taken'; end if;
    -- The same acceptance again: Phase 1 returns the order it made (or says the content changed)
    return cdf_numbering.create_order(p_request, p_order, p_price, p_payment, v_reserved) || jsonb_build_object('request', to_jsonb(v_row));
  end if;
  if v_row.status not in ('received', 'in_review') then raise exception 'cdf_request_closed'; end if;

  v_made := cdf_numbering.create_order(p_request, p_order, p_price, p_payment, v_reserved);
  v_order := (v_made->'order'->>'id')::uuid;
  update public.cdf_order_requests set status = 'accepted', accepted_order_id = v_order, accepted_key = p_request,
    reviewed_by = v_actor, reviewed_at = now(), updated_at = now(), version = version + 1
  where id = p_id returning * into v_row;
  insert into public.cdf_request_events (request_id, kind, by_email, detail)
  values (p_id, 'accepted', v_actor, jsonb_build_object('order_id', v_order, 'num', v_made->'order'->>'num'));
  return v_made || jsonb_build_object('request', to_jsonb(v_row));
end $$;

create or replace function public.cdf_request_similar(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_row public.cdf_order_requests%rowtype;
begin
  perform public.cdf_request_admin();
  select * into v_row from public.cdf_order_requests where id = p_id;
  if not found then raise exception 'cdf_request_gone'; end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'shared_number', r.shared_number, 'status', r.status) order by r.created_at)
      from public.cdf_order_requests r
      where r.id <> v_row.id and r.date = v_row.date and r.status <> 'rejected'
        and (r.buyer_phone in (v_row.buyer_phone, v_row.receiver_phone) or r.receiver_phone in (v_row.buyer_phone, v_row.receiver_phone))), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'num', o.num) order by o.num)
      from public.cdf_orders o
      where o.date = v_row.date and o.cancelled_at is null and (o.id is distinct from v_row.accepted_order_id)
        and (o.buyer_phone in (v_row.buyer_phone, v_row.receiver_phone) or o.customer_phone in (v_row.buyer_phone, v_row.receiver_phone))), '[]'));
end $$;

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
    return jsonb_build_object('id', v_found.id, 'ref', v_found.ref, 'shared_number', v_found.shared_number, 'replayed', true);
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
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'shared_number', true, 'replayed', false);
end $$;

-- Keep the request label consistent when its reference photos are viewed from the order.
drop function public.cdf_order_references(uuid);
create function public.cdf_order_references(p_order uuid) returns table (id uuid, kind text, path text, width integer, height integer, request_ref bigint, shared_number boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.kind, f.path, f.width, f.height, r.ref, r.shared_number
  from public.cdf_order_requests r
  join public.cdf_request_files f on f.request_id = r.id and f.status = 'ready'
  join public.cdf_orders o on o.id = r.accepted_order_id
  where r.accepted_order_id = p_order
    and (coalesce(public.cdf_is_admin(), false)
      or (f.kind = 'reference' and o.vendor_email = lower(coalesce(auth.jwt()->>'email', ''))))
  order by f.kind desc, f.created_at
$$;
revoke all on function public.cdf_order_references(uuid) from public, anon;
grant execute on function public.cdf_order_references(uuid) to authenticated, service_role;

commit;
