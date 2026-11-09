-- Preserve the previous accumulated payment and private proofs as an opening entry.
alter table public.cdf_order_prices add column payment_history jsonb not null default '[]';

update public.cdf_order_prices
set payment_history = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid(), 'kind', 'opening', 'amount', coalesce(paid, 0),
  'proofs', pay_proofs
))
where coalesce(paid, 0) <> 0 or cardinality(pay_proofs) > 0;

-- Keep the existing price writer, but reserve payment fields for the RPC.
revoke insert, update on public.cdf_order_prices from authenticated;
grant insert (order_id, amount), update (order_id, amount) on public.cdf_order_prices to authenticated;

create function public.cdf_check_price_against_paid() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.order_id is distinct from old.order_id then
    raise exception 'cdf_payment_order_immutable' using errcode = '42501';
  end if;
  if new.amount is distinct from old.amount and coalesce(new.paid, 0) > coalesce(new.amount, 0) then
    raise exception 'cdf_price_below_paid';
  end if;
  return new;
end $$;

create trigger cdf_price_against_paid before update on public.cdf_order_prices
for each row execute function public.cdf_check_price_against_paid();

create function public.cdf_record_payment(
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
