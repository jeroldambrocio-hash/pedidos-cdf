-- 11/11/2026. Phase 1: an order, its price and its down payment are saved in one transaction.
-- Additive only: one new table, one new function, three optional fields on new payment movements.
-- Nothing is dropped or renamed, no existing row changes, and the client published today keeps working
-- (it calls cdf_record_payment with its eight arguments, which behave exactly as before).

-- Preconditions: this builds on the incremental payments migration (registered in production as 20261109210232).
do $$
begin
  if to_regprocedure('public.cdf_record_payment(uuid,uuid,numeric,text[],numeric,numeric,uuid,text)') is null
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cdf_order_prices' and column_name = 'payment_history') then
    raise exception 'cdf_create_order needs the incremental payments migration first';
  end if;
end $$;

-- 1) Operation keys: a repeated request (double tap, retry after a lost answer) gets the first result back;
--    the same key with different content is refused. Only the functions below touch this table.
create table public.cdf_operation_keys (
  key uuid primary key,
  kind text not null,
  by_email text not null,
  fingerprint text not null,
  order_id uuid references public.cdf_orders(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.cdf_operation_keys enable row level security;
revoke all on public.cdf_operation_keys from public, anon, authenticated;
grant all on public.cdf_operation_keys to service_role;

-- 2) Payment movements can say how and when the money came in. Same rules as before, three more fields:
--    p_method (short text), p_reference (optional) and p_paid_at (the day the customer paid, as declared;
--    created_at stays the moment it was recorded and by_email who recorded it). Older movements keep
--    what they have; nothing is invented for them.
create function public.cdf_record_payment(
  p_order uuid, p_request uuid, p_amount numeric, p_proofs text[],
  p_price numeric, p_seen_price numeric, p_reverses uuid, p_reason text,
  p_method text, p_reference text, p_paid_at date
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
      p_method := nullif(btrim(p_method), '');
      p_reference := nullif(btrim(p_reference), '');
      if length(p_method) > 40 or length(p_reference) > 120
        or p_paid_at < date '2020-01-01' or p_paid_at > (now() at time zone 'Asia/Manila')::date then
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
      p_method := null; p_reference := null; p_paid_at := null;
    end if;

    v_entry := jsonb_build_object(
      'id', p_request, 'kind', case when p_reverses is null then 'payment' else 'reversal' end,
      'amount', v_delta, 'created_at', clock_timestamp(), 'by_email', v_actor,
      'proofs', coalesce(p_proofs, '{}'), 'reverses', p_reverses, 'reason', nullif(btrim(p_reason), ''),
      'method', p_method, 'reference', p_reference, 'paid_at', p_paid_at
    );
    update public.cdf_order_prices
    set amount = v_total, paid = coalesce(v_price.paid, 0) + v_delta,
        payment_history = payment_history || jsonb_build_array(v_entry)
    where order_id = p_order returning * into v_price;
  end if;
  return to_jsonb(v_price);
end $$;

revoke all on function public.cdf_record_payment(uuid, uuid, numeric, text[], numeric, numeric, uuid, text, text, text, date) from public, anon;
grant execute on function public.cdf_record_payment(uuid, uuid, numeric, text[], numeric, numeric, uuid, text, text, text, date) to authenticated;

-- The eight-argument entry point stays for the client already published: one set of rules, kept in one place.
create or replace function public.cdf_record_payment(
  p_order uuid, p_request uuid, p_amount numeric, p_proofs text[],
  p_price numeric, p_seen_price numeric, p_reverses uuid, p_reason text
) returns jsonb
language sql security definer set search_path = '' as $$
  select public.cdf_record_payment(p_order, p_request, p_amount, p_proofs, p_price, p_seen_price, p_reverses, p_reason,
    null::text, null::text, null::date)
$$;

-- 3) Create an order with its price and, optionally, its first payment. All of it or none of it.
--    p_order: the order's own fields (anything else is refused; status and credit fields keep their defaults).
--    p_price: the total, or null for an order without a price yet.
--    p_payment: null for no payment, or {amount, method, paid_at, reference?, proofs?}. Never a zero movement.
--    The payment goes through cdf_record_payment, so its rules are the ones already in use.
--    Called with nothing at all it only answers {"available": true}: the panel asks this once per session
--    to know whether to offer the down payment, without writing anything or raising an error.
create function public.cdf_create_order(p_request uuid, p_order jsonb, p_price numeric, p_payment jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text := lower(auth.jwt()->>'email');
  v_fields constant text[] := array['id', 'num', 'date', 'slot', 'channel', 'notes', 'vendor_email', 'carrier_email',
    'customer_name', 'address', 'delivery_note', 'customer_phone', 'customer_email', 'buyer_name', 'buyer_phone',
    'card_message', 'drop_lat', 'drop_lng', 'vehicle'];
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
    or exists (select 1 from jsonb_object_keys(p_order) k where k <> all (v_fields)) then
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

  -- Same key: the first call's result. A second call arriving while the first is still running waits here
  -- for it, then takes this branch (or goes ahead if the first one failed and left nothing).
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
    delivery_note, customer_phone, customer_email, buyer_name, buyer_phone, card_message, drop_lat, drop_lng, vehicle)
  select coalesce(r.id, gen_random_uuid()), r.num, r.date, r.slot, r.channel, coalesce(r.notes, ''),
    nullif(r.vendor_email, ''), nullif(r.carrier_email, ''), coalesce(r.customer_name, ''), coalesce(r.address, ''),
    coalesce(r.delivery_note, ''), coalesce(r.customer_phone, ''), coalesce(r.customer_email, ''),
    coalesce(r.buyer_name, ''), coalesce(r.buyer_phone, ''), coalesce(r.card_message, ''), r.drop_lat, r.drop_lng, r.vehicle
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

revoke all on function public.cdf_create_order(uuid, jsonb, numeric, jsonb) from public, anon;
grant execute on function public.cdf_create_order(uuid, jsonb, numeric, jsonb) to authenticated;
