-- A replacement must wait until every prior PayMongo checkout is confirmed closed.
alter table public.cdf_request_payments add column closed_checkout_id text;

create function public.cdf_request_paylink_unclosed(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.cdf_request_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'checkout_id', p.checkout_id))
    from public.cdf_request_payments p
    where p.request_id = p_id and p.status <> 'paid' and p.checkout_id is not null
      and p.closed_checkout_id is distinct from p.checkout_id
  ), '[]'::jsonb);
end $$;

create function public.cdf_paylink_confirm_closed(p_payment uuid, p_checkout text) returns boolean
language sql security definer set search_path = '' as $$
  with closed as (
    update public.cdf_request_payments set closed_checkout_id = p_checkout
    where id = p_payment and checkout_id = p_checkout and status <> 'paid' returning 1
  ) select exists (select 1 from closed)
$$;

alter function public.cdf_request_paylink(uuid, text, uuid, jsonb, numeric) rename to cdf_request_paylink_insert;
revoke execute on function public.cdf_request_paylink_insert(uuid, text, uuid, jsonb, numeric) from public, anon, authenticated;

create function public.cdf_request_paylink(p_id uuid, p_token text, p_key uuid, p_order jsonb, p_price numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pay record;
begin
  perform public.cdf_request_admin();
  -- Serialize new links for this request, then lock existing rows against concurrent checkout writes.
  perform 1 from public.cdf_order_requests where id = p_id for update;
  for v_pay in
    select status, checkout_id, closed_checkout_id from public.cdf_request_payments
    where request_id = p_id for update
  loop
    if v_pay.status <> 'paid' and v_pay.checkout_id is not null
      and v_pay.closed_checkout_id is distinct from v_pay.checkout_id then
      raise exception 'cdf_paymongo_unreachable';
    end if;
  end loop;
  return public.cdf_request_paylink_insert(p_id, p_token, p_key, p_order, p_price);
end $$;

revoke execute on function public.cdf_request_paylink(uuid, text, uuid, jsonb, numeric),
  public.cdf_request_paylink_unclosed(uuid), public.cdf_paylink_confirm_closed(uuid, text) from public, anon, authenticated;
grant execute on function public.cdf_request_paylink(uuid, text, uuid, jsonb, numeric),
  public.cdf_request_paylink_unclosed(uuid) to authenticated;
grant execute on function public.cdf_paylink_confirm_closed(uuid, text) to service_role;

