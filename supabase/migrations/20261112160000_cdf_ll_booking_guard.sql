-- 12/11/2026. Audit (12/11) F01 and F02: a rider booking that can't be lost or doubled, and an order with
-- a rider on it that can't be deleted.
--
-- F01. Booking a rider is two systems: Lalamove (POST /v3/orders) and our row in cdf_lalamove. Until now the
-- function checked "no rider yet", called Lalamove, and saved the answer afterwards: two phones at once could
-- both book, and an answer lost after Lalamove accepted left a real booking with nothing saved here.
-- Now the database holds the booking attempt BEFORE Lalamove is called:
--   claim   → booking_state 'pending' with a key, under a row lock: a second attempt for the same order is
--             refused while one is pending, uncertain or a rider is already on it.
--   done    → the key matches: Lalamove's order id is saved, the attempt closes.
--   failed  → Lalamove said no (a 4xx): the attempt closes, nothing was booked.
--             No answer, a 5xx, or the save failing after Lalamove said yes: 'uncertain'. Nobody can book
--             again until it is resolved, never automatically:
--               · Lalamove's webhook for that booking links it (metadata carries the key), or
--               · an admin gives Lalamove's order id (checked against Lalamove), or confirms nothing was booked.
--   A 'pending' left by a function that died mid-way counts as uncertain after two minutes.
-- A new price (quote) can no longer overwrite a booking made meanwhile: it is stored through a function that
-- refuses while an attempt or a rider is on the order.
--
-- F02. Deleting an order cascaded to its booking rows without cancelling the rider in Lalamove. Now the
-- database refuses to delete an order with a rider still on it (or a booking attempt pending or uncertain).
-- Cancel the rider first (or cancel the order, which does), then delete.
--
-- Additive only: four columns, one constraint, one trigger and seven functions (server only).

do $$
begin
  if to_regclass('public.cdf_lalamove_shipments') is null then
    raise exception 'cdf_ll_booking_guard needs the Lalamove events migration (Phase 5) first';
  end if;
end $$;

-- 1) The attempt in progress, kept on the order's Lalamove row
alter table public.cdf_lalamove
  add column booking_key uuid,
  add column booking_state text check (booking_state in ('pending', 'uncertain')),
  add column booking_started_at timestamptz,
  add column booking_by text,
  add constraint cdf_lalamove_booking_pair check ((booking_state is null) = (booking_key is null));

-- Lalamove's final statuses (as FINAL in cdf-lalamove/lalamove.ts): a booking in one of them has no rider on it
create function public.cdf_ll_final(p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_status, '') in ('COMPLETED', 'CANCELED', 'REJECTED', 'EXPIRED')
$$;

-- An attempt left 'pending' for over two minutes: the function stopped mid-way. It may have reached Lalamove.
create function public.cdf_ll_settle_stale(r public.cdf_lalamove) returns public.cdf_lalamove
language plpgsql set search_path = '' as $$
begin
  if r.booking_state = 'pending' and r.booking_started_at < now() - interval '2 minutes' then
    update public.cdf_lalamove set booking_state = 'uncertain',
      error = coalesce(error, 'La reserva no terminó: comprueba en Lalamove si se hizo')
    where order_id = r.order_id returning * into r;
  end if;
  return r;
end $$;

-- 2) Before calling Lalamove: one attempt per order. Errors (by name): cdf_ll_no_quote, cdf_ll_booking_busy,
--    cdf_ll_booking_uncertain, cdf_ll_already_booked.
create function public.cdf_ll_book_claim(p_order uuid, p_key uuid, p_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_lalamove;
begin
  if p_order is null or p_key is null then raise exception 'cdf_ll_no_quote'; end if;
  select * into r from public.cdf_lalamove where order_id = p_order for update;
  if not found or r.quotation_id is null then raise exception 'cdf_ll_no_quote'; end if;
  r := public.cdf_ll_settle_stale(r);
  if r.booking_state = 'pending' then raise exception 'cdf_ll_booking_busy'; end if;
  if r.booking_state = 'uncertain' then raise exception 'cdf_ll_booking_uncertain'; end if;
  if r.ll_order_id is not null and not public.cdf_ll_final(r.status) then raise exception 'cdf_ll_already_booked'; end if;
  update public.cdf_lalamove set booking_key = p_key, booking_state = 'pending', booking_started_at = now(),
    booking_by = left(p_by, 200), error = null
  where order_id = p_order returning * into r;
  return to_jsonb(r);
end $$;

-- 3) Lalamove accepted: its order id is saved and the attempt closes. If the attempt was already resolved
--    (the webhook linked this same booking meanwhile) the row is returned as it is.
create function public.cdf_ll_book_done(p_order uuid, p_key uuid, p_ll text, p_status text, p_share text, p_price numeric)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_lalamove;
begin
  if coalesce(p_ll, '') = '' then raise exception 'cdf_ll_booking_lost'; end if;
  update public.cdf_lalamove set ll_order_id = p_ll, status = coalesce(p_status, 'ASSIGNING_DRIVER'), share_link = p_share,
    price_total = coalesce(p_price, quote_total), booked_at = now(), error = null, cancelled_by_us = false,
    booking_key = null, booking_state = null, booking_started_at = null, booking_by = null
  where order_id = p_order and booking_key = p_key returning * into r;
  if found then return to_jsonb(r); end if;
  select * into r from public.cdf_lalamove where order_id = p_order;
  if r.ll_order_id = p_ll then return to_jsonb(r); end if;
  raise exception 'cdf_ll_booking_lost';
end $$;

-- 4) Lalamove said no (p_uncertain false: nothing booked), or we can't know (true: held for checking)
create function public.cdf_ll_book_failed(p_order uuid, p_key uuid, p_uncertain boolean, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_lalamove;
begin
  if p_uncertain then
    update public.cdf_lalamove set booking_state = 'uncertain', error = left(p_error, 500)
    where order_id = p_order and booking_key = p_key returning * into r;
  else
    update public.cdf_lalamove set booking_key = null, booking_state = null, booking_started_at = null, booking_by = null,
      error = left(p_error, 500)
    where order_id = p_order and booking_key = p_key returning * into r;
  end if;
  return to_jsonb(r);
end $$;

-- 5) An admin resolved an uncertain attempt: with p_ll, the booking Lalamove has (already checked against
--    Lalamove by the function); without, nothing was booked (checked by the admin in Lalamove).
create function public.cdf_ll_book_resolve(p_order uuid, p_by text, p_ll text, p_status text, p_share text, p_price numeric)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_lalamove;
begin
  select * into r from public.cdf_lalamove where order_id = p_order for update;
  if not found then raise exception 'cdf_ll_nothing_to_resolve'; end if;
  r := public.cdf_ll_settle_stale(r);
  if r.booking_state is distinct from 'uncertain' then raise exception 'cdf_ll_nothing_to_resolve'; end if;
  if coalesce(p_ll, '') <> '' then
    if exists (select 1 from public.cdf_lalamove_shipments s where s.ll_order_id = p_ll and s.order_id <> p_order) then
      raise exception 'cdf_ll_other_order';
    end if;
    update public.cdf_lalamove set ll_order_id = p_ll, status = coalesce(p_status, 'ASSIGNING_DRIVER'), share_link = p_share,
      price_total = coalesce(p_price, quote_total), booked_at = now(), cancelled_by_us = false,
      error = null, booking_key = null, booking_state = null, booking_started_at = null, booking_by = null
    where order_id = p_order returning * into r;
  else
    update public.cdf_lalamove set error = left('Sin reserva (comprobado por ' || coalesce(p_by, '?') || ')', 500),
      booking_key = null, booking_state = null, booking_started_at = null, booking_by = null
    where order_id = p_order returning * into r;
  end if;
  return to_jsonb(r);
end $$;

-- 6) The webhook brings a Lalamove order we don't know whose metadata carries one of our attempt keys: it is
--    that attempt's booking. Linked only to the order whose pending or uncertain attempt has that key.
create function public.cdf_ll_link_attempt(p_key uuid, p_new text, p_env text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_order uuid;
begin
  if p_key is null or coalesce(p_new, '') = '' or exists (select 1 from public.cdf_lalamove_shipments where ll_order_id = p_new) then return null; end if;
  update public.cdf_lalamove set ll_order_id = p_new, status = coalesce(status, 'ASSIGNING_DRIVER'), booked_at = coalesce(booked_at, now()),
    error = null, cancelled_by_us = false, booking_key = null, booking_state = null, booking_started_at = null, booking_by = null
  where booking_key = p_key and env = p_env and booking_state is not null
  returning order_id into v_order;
  return v_order;
end $$;

-- 7) A new price, stored only while no attempt and no rider is on the order (a booking made meanwhile is never
--    overwritten). Clears the previous, finished booking, as the function always did.
create function public.cdf_ll_quote_store(p_order uuid, p_env text, p_quote jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_lalamove;
begin
  insert into public.cdf_lalamove (order_id, env) values (p_order, p_env) on conflict (order_id) do nothing;
  select * into r from public.cdf_lalamove where order_id = p_order for update;
  r := public.cdf_ll_settle_stale(r);
  if r.booking_state = 'pending' then raise exception 'cdf_ll_booking_busy'; end if;
  if r.booking_state = 'uncertain' then raise exception 'cdf_ll_booking_uncertain'; end if;
  if r.ll_order_id is not null and not public.cdf_ll_final(r.status) then raise exception 'cdf_ll_already_booked'; end if;
  update public.cdf_lalamove set env = p_env,
    lat = (p_quote->>'lat')::numeric, lng = (p_quote->>'lng')::numeric, place = p_quote->>'place',
    service = coalesce(p_quote->>'service', 'MOTORCYCLE'), quotation_id = p_quote->>'quotation_id',
    sender_stop = p_quote->>'sender_stop', recipient_stop = p_quote->>'recipient_stop',
    quote_total = (p_quote->>'quote_total')::numeric, quote_currency = coalesce(p_quote->>'quote_currency', 'PHP'),
    quote_expires = (p_quote->>'quote_expires')::timestamptz, quote_for = p_quote->'quote_for',
    ll_order_id = null, status = null, share_link = null, price_total = null, driver_id = null, driver_name = null,
    driver_phone = null, driver_plate = null, driver_photo = null, booked_at = null, error = null
  where order_id = p_order returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function public.cdf_ll_settle_stale(public.cdf_lalamove), public.cdf_ll_book_claim(uuid, uuid, text),
  public.cdf_ll_book_done(uuid, uuid, text, text, text, numeric), public.cdf_ll_book_failed(uuid, uuid, boolean, text),
  public.cdf_ll_book_resolve(uuid, text, text, text, text, numeric), public.cdf_ll_link_attempt(uuid, text, text),
  public.cdf_ll_quote_store(uuid, text, jsonb), public.cdf_ll_final(text) from public, anon, authenticated;
grant execute on function public.cdf_ll_book_claim(uuid, uuid, text), public.cdf_ll_book_done(uuid, uuid, text, text, text, numeric),
  public.cdf_ll_book_failed(uuid, uuid, boolean, text), public.cdf_ll_book_resolve(uuid, text, text, text, text, numeric),
  public.cdf_ll_link_attempt(uuid, text, text), public.cdf_ll_quote_store(uuid, text, jsonb) to service_role;
-- Used inside the guard below, which runs as whoever deletes
grant execute on function public.cdf_ll_final(text) to authenticated, service_role;

-- 8) F02: no deleting an order with a rider still on it (or an attempt pending or uncertain)
create function public.cdf_guard_order_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.cdf_lalamove l where l.order_id = old.id
      and (l.booking_state is not null or (l.ll_order_id is not null and not public.cdf_ll_final(l.status)))) then
    raise exception 'cdf_order_has_rider' using errcode = 'P0001',
      hint = 'Cancel the Lalamove rider (or the order) first, then delete it.';
  end if;
  return old;
end $$;
revoke all on function public.cdf_guard_order_delete() from public, anon, authenticated;
create trigger cdf_orders_guard_delete before delete on public.cdf_orders
  for each row execute function public.cdf_guard_order_delete();
