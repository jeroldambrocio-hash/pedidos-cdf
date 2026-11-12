-- 12/11/2026. Pickup orders: the customer collects the order at a shop instead of having it delivered.
-- Approved by the owner: states Preparing → Ready for pickup → Picked up, or Not collected; no "On the way",
-- no rider. The public form lets the customer choose the shop (by zone; the full address once chosen).
--
-- Additive only: two columns, two constraints, two new functions, and new versions of three functions
-- (cdf_progress, cdf_create_order, cdf_request_submit), each the previous body plus the pickup rule. No row changes: every existing order stays a delivery, every request as it was.
--
-- The states reuse the existing values, so statistics, filters and history keep working as they are:
--   Ready + '-'        → "Ready for pickup"
--   Ready + Delivered  → "Picked up"
--   Ready + Failed     → "Not collected"
--   Ready + In transit → never, for a pickup (the constraint below refuses it whoever writes it)

do $$
begin
  if to_regprocedure('public.cdf_create_order(uuid, jsonb, numeric, jsonb)') is null
    or to_regclass('public.cdf_order_requests') is null then
    raise exception 'cdf_pickup_orders needs the create-order (Phase 1) and order-requests (Phase 3) migrations first';
  end if;
end $$;

-- 1) The order knows it is a pickup
alter table public.cdf_orders add column pickup boolean not null default false;
alter table public.cdf_orders add constraint cdf_orders_pickup_no_transit check (not (pickup and delivery = 'In transit'));

-- 2) The shop the customer chose on the form (the branch name, as in Team). Only with a pickup.
alter table public.cdf_order_requests add column pickup_branch text;
alter table public.cdf_order_requests add constraint cdf_order_requests_pickup_branch
  check (pickup_branch is null or (mode = 'pickup' and char_length(pickup_branch) between 1 and 60));

-- 3) The shops a customer can pick up from, for the public form (through cdf-public-order, which runs as the
--    service role: the browser never calls the database). Shop names and addresses are public (they are the
--    shops); nothing about the florists is given, only whether the shop is open that day.
--    Same grouping as the nearest-shop suggestion (Phase 4): a shop is a branch name at one point.
create function public.cdf_pickup_shops(p_date date default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('branch', s.branch, 'address', s.address, 'lat', s.plat, 'lng', s.plng,
      'available', not s.all_away) order by s.branch), '[]'::jsonb)
  from (
    select btrim(m.branch) as branch, round(m.pickup_lat, 5) as plat, round(m.pickup_lng, 5) as plng,
      min(nullif(btrim(m.pickup_address), '')) as address,
      bool_and(p_date is not null and m.away_from is not null and p_date >= m.away_from
        and (m.away_until is null or p_date <= m.away_until)) as all_away
    from public.cdf_members m
    where m.role = 'vendor' and nullif(btrim(m.branch), '') is not null and m.pickup_lat is not null
      and m.pickup_lat between 4 and 21.5 and m.pickup_lng between 116 and 127
    group by btrim(m.branch), round(m.pickup_lat, 5), round(m.pickup_lng, 5)
  ) s
$$;
revoke all on function public.cdf_pickup_shops(date) from public, anon, authenticated;
grant execute on function public.cdf_pickup_shops(date) to service_role;

-- 4) Moving a pickup: the steps follow from each other as for a delivery, without On the way.
--    Florists: Preparing ↔ Ready, Ready → Picked up / Not collected, Not collected → Ready / Picked up.
create function public.cdf_pickup_step_ok(p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select p_from = p_to or (p_from, p_to) in (('prep', 'ready'), ('ready', 'prep'), ('ready', 'done'), ('ready', 'fail'),
    ('fail', 'ready'), ('fail', 'done'))
$$;
revoke all on function public.cdf_pickup_step_ok(text, text) from public, anon;
grant execute on function public.cdf_pickup_step_ok(text, text) to authenticated;

-- The previous cdf_progress (20261028012537), with the pickup rule: no On the way, and its own steps.
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
  if r.pickup and p_step = 'transit' then
    raise exception 'cdf_pickup_no_transit' using errcode = '22023';
  end if;
  if v_role = 'carrier' and (r.pickup or p_step not in ('transit', 'done', 'fail')) then
    raise exception 'carriers can only set In transit, Delivered or Failed' using errcode = '42501';
  end if;
  if not public.cdf_is_staff() and not (case when r.pickup
      then public.cdf_pickup_step_ok(public.cdf_step_of(r.status, r.delivery), p_step)
      else public.cdf_step_ok(public.cdf_step_of(r.status, r.delivery), p_step) end) then
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

-- 5) Creating an order: the previous cdf_create_order (20261111090000), with 'pickup' among the fields.
create or replace function public.cdf_create_order(p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
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

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'order', p_order, 'price', trim_scale(p_price), 'payment', p_payment)::text, 'UTF8')), 'hex');
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
  select coalesce(r.id, gen_random_uuid()), r.num, r.date, r.slot, r.channel, coalesce(r.notes, ''),
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

-- 6) Receiving a request: the previous cdf_request_submit (20261111110000), plus the chosen shop. A shop
--    that does not exist (or closed that day) is refused, as anything else the form would not accept.
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
