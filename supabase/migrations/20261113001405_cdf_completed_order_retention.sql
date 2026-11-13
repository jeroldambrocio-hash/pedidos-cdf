-- Successful orders are retained for statistics, including after archiving.
-- completed is a derived public status only: no amount/payment history is exposed to staff.
alter table public.cdf_orders
  add column completed boolean not null default false,
  add column fulfilled_at timestamptz;

create function public.cdf_order_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.fulfilled_at := old.fulfilled_at;
  else
    new.fulfilled_at := null;
  end if;
  if new.delivery = 'Delivered' and new.cancelled_at is null then
    new.fulfilled_at := coalesce(new.fulfilled_at, now());
  end if;
  -- A browser cannot choose this flag: the price ledger and fulfilment determine it.
  new.completed := coalesce(new.delivery = 'Delivered' and new.cancelled_at is null and exists (
    select 1 from public.cdf_order_prices p where p.order_id = new.id
      and p.amount is not null and p.paid is not null and p.paid >= p.amount), false);
  return new;
end $$;
revoke all on function public.cdf_order_completion() from public, anon, authenticated;
create trigger cdf_orders_completion before insert or update on public.cdf_orders
  for each row execute function public.cdf_order_completion();

create function public.cdf_price_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  update public.cdf_orders set completed = completed
    where id = v_id and deleted_at is null;
  return null;
end $$;
revoke all on function public.cdf_price_completion() from public, anon, authenticated;
create trigger cdf_prices_completion after insert or update of amount, paid or delete on public.cdf_order_prices
  for each row execute function public.cdf_price_completion();

create function public.cdf_keep_successful_order() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.fulfilled_at is not null or old.delivery = 'Delivered'
    or (tg_op = 'UPDATE' and (new.fulfilled_at is not null or new.delivery = 'Delivered')) then
    if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
      raise exception 'cdf_successful_order_retained' using errcode = '42501',
        hint = 'Archive this order instead. Successful orders stay in statistics.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.cdf_keep_successful_order() from public, anon, authenticated;
create trigger cdf_orders_keep_success before delete or update on public.cdf_orders
  for each row execute function public.cdf_keep_successful_order();

-- Derive current status for existing rows, including old successful rows already in the trash.
-- Keep the trash intact; the history loader includes retained successes even there.
select set_config('cdf.trash','on',true);
update public.cdf_orders set completed = completed;
select set_config('cdf.trash','',true);

