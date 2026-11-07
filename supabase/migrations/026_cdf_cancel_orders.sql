-- Cancelled orders: a terminal state with a reason, separate from a failed delivery.
-- Only an admin cancels or reinstates (cdf_cancel_order / cdf_reinstate_order). A cancelled order keeps
-- its status and delivery as they were (so reinstating puts it back exactly), but no step can move
-- while it is cancelled, it leaves the open counts and absence conflicts, the history records who
-- cancelled it and why, and the florist and driver it was assigned to get a push.

alter table public.cdf_orders
  add column cancelled_at timestamptz,
  add column cancelled_by text,
  add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500);

create function public.cdf_cancel_order(p_id uuid, p_reason text)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.cdf_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if r.cancelled_at is not null then raise exception 'already cancelled' using errcode = '22023'; end if;
  if r.delivery = 'Delivered' then raise exception 'a delivered order cannot be cancelled' using errcode = '22023'; end if;
  update public.cdf_orders set cancelled_at = now(), cancelled_by = lower(coalesce(auth.jwt() ->> 'email', '')),
    cancel_reason = left(v_reason, 500)
  where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.cdf_cancel_order(uuid, text) from public, anon;
grant execute on function public.cdf_cancel_order(uuid, text) to authenticated;

create function public.cdf_reinstate_order(p_id uuid)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders;
begin
  if not public.cdf_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.cdf_orders set cancelled_at = null, cancelled_by = null, cancel_reason = null
  where id = p_id and cancelled_at is not null returning * into r;
  if r.id is null then raise exception 'order not found or not cancelled' using errcode = 'P0002'; end if;
  return r;
end $$;
revoke all on function public.cdf_reinstate_order(uuid) from public, anon;
grant execute on function public.cdf_reinstate_order(uuid) to authenticated;

-- Nothing moves a cancelled order along (cdf_progress, cdf_reschedule, bulk actions, a stale editor):
-- reinstate it first. Its other details (notes, address…) can still be corrected.
create function public.cdf_cancelled_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.cancelled_at is not null and new.cancelled_at is not null
     and (new.status is distinct from old.status or new.delivery is distinct from old.delivery
          or new.attempts is distinct from old.attempts) then
    raise exception 'this order is cancelled' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.cdf_cancelled_guard() from public, anon, authenticated;
create trigger cdf_orders_cancelled_guard before update on public.cdf_orders
  for each row execute function public.cdf_cancelled_guard();

-- History: "cancelled" (with the reason) and "reinstated" are their own entries.
alter table public.cdf_order_events drop constraint cdf_order_events_kind_check;
alter table public.cdf_order_events add constraint cdf_order_events_kind_check
  check (kind in ('created', 'updated', 'status', 'rescheduled', 'archived', 'restored', 'cancelled', 'reinstated'));
create or replace function public.cdf_log_order() returns trigger
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

  if old.cancelled_at is null and new.cancelled_at is not null then
    v_kind := 'cancelled'; v_changes := v_changes || jsonb_build_object('cancel_reason', jsonb_build_array(null, new.cancel_reason));
  elsif old.cancelled_at is not null and new.cancelled_at is null then
    v_kind := 'reinstated'; v_changes := v_changes || jsonb_build_object('cancel_reason', jsonb_build_array(old.cancel_reason, null));
  elsif old.archived_at is null and new.archived_at is not null then v_kind := 'archived';
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

-- The florist and the driver it was assigned to hear that it is off (not whoever cancelled it).
create function public.cdf_push_cancelled() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', '')); e text;
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    foreach e in array array[new.vendor_email, new.carrier_email] loop
      if e is not null and e <> v_me then
        perform public.cdf_push_hook(jsonb_build_object('kind', 'cancelled', 'id', new.id, 'to', e));
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.cdf_push_cancelled() from public, anon, authenticated;
create trigger cdf_orders_push_cancelled after update of cancelled_at on public.cdf_orders
  for each row execute function public.cdf_push_cancelled();

-- A cancelled order is no longer open work, nor a clash with someone's absence.
create or replace function public.cdf_member_stats()
returns table (email text, done_total bigint, done_month bigint, done_week bigint, open_now bigint, arranged_total bigint, delivered_total bigint)
language sql stable security definer set search_path = '' as $$
  with me as (select public.cdf_my_role() as role, lower(coalesce(auth.jwt() ->> 'email', '')) as email),
       today as (select (now() at time zone 'Asia/Manila')::date as d)
  select m.email,
    count(distinct o.id) filter (where o.delivery = 'Delivered'),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date >= date_trunc('month', (select d from today))::date and o.date <= (select d from today)),
    count(distinct o.id) filter (where o.delivery = 'Delivered' and o.date > (select d from today) - 7 and o.date <= (select d from today)),
    (select count(*) from public.cdf_orders p where p.archived_at is null and p.cancelled_at is null and p.delivery is distinct from 'Delivered'
      and (p.vendor_email = m.email or p.carrier_email = m.email)),
    count(distinct o.id) filter (where o.prepared_by = m.email and o.delivery = 'Delivered'
      and (o.delivered_by is distinct from m.email or o.proof_path is not null)),
    count(distinct o.id) filter (where o.delivered_by = m.email and o.delivery = 'Delivered' and o.proof_path is not null)
  from public.cdf_members m cross join me
  left join public.cdf_orders o on (o.prepared_by = m.email or o.delivered_by = m.email)
  where me.role = 'admin' or m.email = me.email
  group by m.email
$$;

create or replace function public.cdf_away_conflicts()
returns table(id uuid, num text, date date, vendor_email text, away_from date, away_until date)
language sql stable security definer set search_path = '' as $$
  select o.id, o.num, o.date, o.vendor_email, m.away_from, m.away_until
  from public.cdf_orders o join public.cdf_members m on m.email = o.vendor_email
  where public.cdf_is_staff() and o.archived_at is null and o.cancelled_at is null and o.delivery is distinct from 'Delivered'
    and m.away_from is not null and o.date >= m.away_from and (m.away_until is null or o.date <= m.away_until)
  order by o.date, o.slot
$$;
