-- 1) Archive instead of delete: delivered orders leave the daily view but keep their history,
--    their photos and their tracking link (the statistics read them too).
-- 2) Change history: every insert and update of an order writes who changed what and when.

alter table public.cdf_orders add column archived_at timestamptz;
create index cdf_orders_open_date_idx on public.cdf_orders (date) where archived_at is null;

create table public.cdf_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cdf_orders(id) on delete cascade,
  at timestamptz not null default now(),
  by_email text,
  kind text not null check (kind in ('created', 'updated', 'status', 'rescheduled', 'archived', 'restored')),
  changes jsonb not null default '{}'::jsonb
);
create index cdf_order_events_order_idx on public.cdf_order_events (order_id, at desc);

alter table public.cdf_order_events enable row level security;
-- Whoever works on the order can read its history; only the trigger writes it.
create policy cdf_order_events_read on public.cdf_order_events for select to authenticated
  using (public.cdf_can_progress(order_id));

-- The fields worth tracking; photos are logged as "changed", never by their storage path.
create function public.cdf_log_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_by text := nullif(lower(coalesce(auth.jwt()->>'email', '')), '');
  v_changes jsonb := '{}'::jsonb;
  v_kind text;
  k text;
  v_old jsonb; v_new jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.cdf_order_events (order_id, by_email, kind, changes)
    values (new.id, v_by, 'created', jsonb_build_object('num', new.num, 'date', new.date, 'slot', new.slot));
    return new;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  foreach k in array array['num', 'date', 'slot', 'channel', 'vendor_email', 'carrier_email', 'customer_name', 'customer_phone',
    'customer_email', 'buyer_name', 'buyer_phone', 'address', 'card_message', 'notes', 'delivery_note', 'status', 'delivery'] loop
    if v_new ? k and (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k, v_new->k));
    end if;
  end loop;
  foreach k in array array['photo_path', 'bouquet_path', 'proof_path'] loop
    if (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k is not null and v_old->>k <> '', v_new->k is not null and v_new->>k <> ''));
    end if;
  end loop;

  if old.archived_at is null and new.archived_at is not null then v_kind := 'archived';
  elsif old.archived_at is not null and new.archived_at is null then v_kind := 'restored';
  elsif new.attempts > old.attempts then v_kind := 'rescheduled';
  elsif v_changes ? 'status' or v_changes ? 'delivery' then v_kind := 'status';
  elsif v_changes = '{}'::jsonb then return new;
  else v_kind := 'updated';
  end if;

  insert into public.cdf_order_events (order_id, by_email, kind, changes) values (new.id, v_by, v_kind, v_changes);
  return new;
end $$;
revoke all on function public.cdf_log_order() from public, anon, authenticated;

create trigger cdf_orders_log after insert or update on public.cdf_orders
  for each row execute function public.cdf_log_order();
