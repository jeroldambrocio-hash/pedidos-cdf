-- 12/11/2026. Orders: a recoverable trash instead of deleting, and the order's type (pickup / delivery) kept
-- everywhere. Asked by the owner after a real case: request R2 (Kober Mananlo) was accepted into order #0007,
-- which was then deleted for good from kober@casadeflores.store; the request still said "Accepted" and its
-- accepted_order_id became null (ON DELETE SET NULL), with nothing saying what happened. #0007 is NOT
-- recreated here: this fixes the system.
--
-- 1) Trash. "Move to trash" (any admin, with a reason) hides the order everywhere but keeps everything: its
--    data, prices and payments, history, photos, proofs and Lalamove rows are the same rows, untouched.
--    "Restore" (any admin within 30 days of trashing; the owner at any time) brings back that same row: no
--    copy, so nothing is duplicated. While in the trash nothing else can change the order.
--    Nothing is ever deleted automatically: past the 30 days the order stays in the trash until the owner
--    decides (the approved evidence policy keeps payments and proofs; a time-based purge would contradict it).
-- 2) Deleting for good: only the owner (cdf_members.is_owner, which nobody can set from the app: only the
--    database itself, as written in the deploy notes), only from the trash, never with a rider on it
--    (20261112160000's guard), and through cdf_order_purge only: a plain DELETE is refused, whoever sends it.
--    Everything goes (decided by the owner 12/11/2026, audit F06): the order, its payments and history, and
--    its files in storage (photos, delivery photos, payment proofs, Lalamove proofs). The files are queued in
--    the same transaction (cdf_storage_deletions) and removed by the cdf-order-purge function, which retries
--    what storage could not remove. The customer's own photos sent with a request stay with that request
--    (the approved retention policy for requests).
-- 3) A log that outlives the order (cdf_order_audit): who trashed, restored or deleted it, when and why. A
--    delete keeps only a summary (number, date, total, paid, how many payments and files): no personal data.
-- 4) Requests keep the number of the order they became (accepted_order_num), so a request whose order is in
--    the trash or was deleted still says which one, and what happened to it (cdf_request_order).
-- 5) Type: orders accepted from a pickup request become pickups (only from that record, never because an
--    address is missing). The history shows a change of type. Exact request counts by status and type.
--
-- Additive: columns, one table, triggers and functions. Existing rows only change in (5) and in the backfill
-- of accepted_order_num.

do $$
begin
  if to_regclass('public.cdf_order_requests') is null or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'cdf_orders' and column_name = 'pickup')
    or to_regprocedure('public.cdf_guard_order_delete()') is null then
    raise exception 'cdf_order_trash needs the pickup (20261112150000) and booking guard (20261112160000) migrations first';
  end if;
end $$;

-- ---------- the owner ----------
alter table public.cdf_members add column is_owner boolean not null default false;
-- Only the database itself (migrations, the SQL editor) changes it: not admins, not the team function.
create function public.cdf_guard_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.is_owner) or (tg_op = 'UPDATE' and new.is_owner is distinct from old.is_owner) then
    if current_user in ('authenticated', 'anon', 'service_role') then
      raise exception 'cdf_owner_locked' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.cdf_guard_owner() from public, anon, authenticated;
create trigger cdf_members_owner_guard before insert or update of is_owner on public.cdf_members
  for each row execute function public.cdf_guard_owner();

create function public.cdf_is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.is_owner and m.role = 'admin' from public.cdf_members m
    where m.email = lower(coalesce(auth.jwt()->>'email', ''))), false)
$$;
revoke all on function public.cdf_is_owner() from public, anon;
grant execute on function public.cdf_is_owner() to authenticated;

-- ---------- the trash ----------
alter table public.cdf_orders
  add column deleted_at timestamptz,
  add column deleted_by text,
  add column delete_reason text,
  add constraint cdf_orders_trash_shape check ((deleted_at is null) = (deleted_by is null)
    and (deleted_at is null or char_length(coalesce(delete_reason, '')) between 3 and 500));
create index cdf_orders_trash on public.cdf_orders (deleted_at) where deleted_at is not null;

-- The log. order_id has no foreign key on purpose: the entries stay after the order is deleted.
create table public.cdf_order_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null,
  order_num text,
  action text not null check (action in ('trashed', 'restored', 'purged')),
  by_email text not null,
  reason text,
  at timestamptz not null default now(),
  snapshot jsonb
);
create index cdf_order_audit_order on public.cdf_order_audit (order_id, at);
create index cdf_order_audit_num on public.cdf_order_audit (order_num);
alter table public.cdf_order_audit enable row level security;
revoke all on public.cdf_order_audit from public, anon, authenticated;
grant select on public.cdf_order_audit to authenticated;
grant all on public.cdf_order_audit to service_role;
create policy cdf_order_audit_admin_read on public.cdf_order_audit for select to authenticated using ((select public.cdf_is_admin()));

-- Trashing, restoring and deleting happen only through the functions below (they set cdf.trash / cdf.purge
-- for their own transaction). A trashed order can't be changed meanwhile, by anyone or anything.
create function public.cdf_guard_trash() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deleted_by is not null or new.delete_reason is not null then
      raise exception 'cdf_trash_only_by_function' using errcode = '42501';
    end if;
    return new;
  end if;
  if coalesce(current_setting('cdf.trash', true), '') = 'on' then return new; end if;
  if (new.deleted_at, new.deleted_by, new.delete_reason) is distinct from (old.deleted_at, old.deleted_by, old.delete_reason) then
    raise exception 'cdf_trash_only_by_function' using errcode = '42501';
  end if;
  if old.deleted_at is not null then
    raise exception 'cdf_order_in_trash' using errcode = '22023', hint = 'Restore the order first.';
  end if;
  return new;
end $$;
revoke all on function public.cdf_guard_trash() from public, anon, authenticated;
create trigger cdf_orders_trash_guard before insert or update on public.cdf_orders
  for each row execute function public.cdf_guard_trash();

-- Files of orders deleted for good, waiting to be removed from storage (cdf-order-purge does it, and retries)
create table public.cdf_storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('cdf-fotos', 'cdf-entregas', 'cdf-pagos', 'cdf-lalamove-proofs')),
  path text not null,
  order_id uuid not null,
  order_num text,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  unique (bucket, path)
);
create index cdf_storage_deletions_pending on public.cdf_storage_deletions (queued_at) where done_at is null;
alter table public.cdf_storage_deletions enable row level security;
revoke all on public.cdf_storage_deletions from public, anon, authenticated;
grant select on public.cdf_storage_deletions to authenticated;
grant all on public.cdf_storage_deletions to service_role;
create policy cdf_storage_deletions_admin_read on public.cdf_storage_deletions for select to authenticated using ((select public.cdf_is_admin()));

-- The function's side: what is pending (a batch), and what happened to each
create function public.cdf_storage_deletions_due(p_limit integer) returns setof public.cdf_storage_deletions
language sql security definer set search_path = '' as $$
  update public.cdf_storage_deletions d set attempts = attempts + 1
  where d.id in (select id from public.cdf_storage_deletions where done_at is null
    order by attempts, queued_at limit greatest(1, least(coalesce(p_limit, 200), 1000)) for update skip locked)
  returning d.*
$$;
create function public.cdf_storage_deletions_result(p_done bigint[], p_failed bigint[], p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.cdf_storage_deletions set done_at = now(), last_error = null where id = any (coalesce(p_done, '{}'));
  update public.cdf_storage_deletions set last_error = left(p_error, 500) where id = any (coalesce(p_failed, '{}'));
$$;
revoke all on function public.cdf_storage_deletions_due(integer), public.cdf_storage_deletions_result(bigint[], bigint[], text) from public, anon, authenticated;
grant execute on function public.cdf_storage_deletions_due(integer), public.cdf_storage_deletions_result(bigint[], bigint[], text) to service_role;

-- No DELETE except cdf_order_purge (and the database's own owner, e.g. a migration or the SQL editor)
create function public.cdf_guard_hard_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('cdf.purge', true), '') <> 'on' and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'cdf_delete_use_trash' using errcode = '42501', hint = 'Move the order to the trash instead.';
  end if;
  return old;
end $$;
revoke all on function public.cdf_guard_hard_delete() from public, anon, authenticated;
create trigger cdf_orders_hard_delete_guard before delete on public.cdf_orders
  for each row execute function public.cdf_guard_hard_delete();

-- A rider still on the order (or a booking not yet confirmed): it stays where it is until that is settled
create function public.cdf_order_rider_on(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cdf_lalamove l where l.order_id = p_id
    and (l.booking_state is not null or (l.ll_order_id is not null and not public.cdf_ll_final(l.status))))
$$;
revoke all on function public.cdf_order_rider_on(uuid) from public, anon, authenticated;

create function public.cdf_order_trash(p_id uuid, p_reason text) returns public.cdf_orders
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders; v_by text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.cdf_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'cdf_trash_reason' using errcode = '22023'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if r.deleted_at is not null then return r; end if;               -- already there (a second tap)
  if public.cdf_order_rider_on(p_id) then raise exception 'cdf_order_has_rider' using errcode = 'P0001'; end if;
  perform set_config('cdf.trash', 'on', true);
  update public.cdf_orders set deleted_at = now(), deleted_by = v_by, delete_reason = btrim(p_reason) where id = p_id returning * into r;
  perform set_config('cdf.trash', '', true);
  insert into public.cdf_order_audit (order_id, order_num, action, by_email, reason)
  values (r.id, r.num, 'trashed', v_by, btrim(p_reason));
  return r;
end $$;

create function public.cdf_order_restore(p_id uuid) returns public.cdf_orders
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders; v_by text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.cdf_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if r.deleted_at is null then return r; end if;                   -- already restored
  if r.deleted_at < now() - interval '30 days' and not public.cdf_is_owner() then
    raise exception 'cdf_restore_expired' using errcode = '42501';
  end if;
  perform set_config('cdf.trash', 'on', true);
  update public.cdf_orders set deleted_at = null, deleted_by = null, delete_reason = null where id = p_id returning * into r;
  perform set_config('cdf.trash', '', true);
  insert into public.cdf_order_audit (order_id, order_num, action, by_email) values (r.id, r.num, 'restored', v_by);
  return r;
end $$;

create function public.cdf_order_purge(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders; v_by text := lower(coalesce(auth.jwt()->>'email', '')); v_snap jsonb;
begin
  if not public.cdf_is_owner() then raise exception 'cdf_owner_only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'cdf_trash_reason' using errcode = '22023'; end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if r.deleted_at is null then raise exception 'cdf_purge_not_in_trash' using errcode = '22023'; end if;
  if public.cdf_order_rider_on(p_id) then raise exception 'cdf_order_has_rider' using errcode = 'P0001'; end if;
  -- Its files, queued in this same transaction: the ones the order points to, and anything else stored in
  -- the order's own folder (a proof uploaded for a payment that was never saved, for example)
  insert into public.cdf_storage_deletions (bucket, path, order_id, order_num)
  select distinct f.bucket, f.path, r.id, r.num from (
    select 'cdf-fotos' as bucket, r.photo_path as path
    union all select 'cdf-entregas', unnest(array[r.proof_path, r.bouquet_path] || coalesce(r.extra_photos, '{}'))
    union all select 'cdf-pagos', unnest(coalesce(p.pay_proofs, '{}')) from public.cdf_order_prices p where p.order_id = p_id
    union all select 'cdf-pagos', jsonb_array_elements_text(coalesce(m->'proofs', '[]'::jsonb))
      from public.cdf_order_prices p, jsonb_array_elements(p.payment_history) m where p.order_id = p_id
    union all select 'cdf-lalamove-proofs', x.storage_path from public.cdf_lalamove_proofs x where x.order_id = p_id
    union all select o.bucket_id, o.name from storage.objects o
      where o.bucket_id in ('cdf-fotos', 'cdf-entregas', 'cdf-pagos', 'cdf-lalamove-proofs') and o.name like p_id::text || '/%'
  ) f where coalesce(f.path, '') <> ''
  on conflict (bucket, path) do nothing;
  -- The log keeps who, when and why, and a summary without personal data
  v_snap := jsonb_build_object('num', r.num, 'date', r.date, 'pickup', r.pickup, 'cancelled', r.cancelled_at is not null,
    'total', (select p.amount from public.cdf_order_prices p where p.order_id = p_id),
    'paid', (select p.paid from public.cdf_order_prices p where p.order_id = p_id),
    'payments', (select jsonb_array_length(p.payment_history) from public.cdf_order_prices p where p.order_id = p_id),
    'lalamove_bookings', (select count(*) from public.cdf_lalamove_shipments s where s.order_id = p_id),
    'files', (select count(*) from public.cdf_storage_deletions d where d.order_id = p_id),
    'request', (select jsonb_build_object('id', q.id, 'ref', q.ref) from public.cdf_order_requests q where q.accepted_order_id = p_id));
  insert into public.cdf_order_audit (order_id, order_num, action, by_email, reason, snapshot)
  values (r.id, r.num, 'purged', v_by, btrim(p_reason), v_snap);
  perform set_config('cdf.purge', 'on', true);
  delete from public.cdf_orders where id = p_id;
  perform set_config('cdf.purge', '', true);
  return jsonb_build_object('purged', r.id, 'num', r.num);
end $$;

revoke all on function public.cdf_order_trash(uuid, text), public.cdf_order_restore(uuid), public.cdf_order_purge(uuid, text) from public, anon;
grant execute on function public.cdf_order_trash(uuid, text), public.cdf_order_restore(uuid), public.cdf_order_purge(uuid, text) to authenticated;

-- The order's history gets "moved to trash" / "restored from trash", and a change of type
alter table public.cdf_order_events drop constraint cdf_order_events_kind_check;
alter table public.cdf_order_events add constraint cdf_order_events_kind_check
  check (kind in ('created', 'updated', 'status', 'rescheduled', 'archived', 'restored', 'cancelled', 'reinstated', 'trashed', 'untrashed'));
-- The previous cdf_log_order (026), plus 'pickup' among the fields and the two trash entries
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
    'customer_email', 'buyer_name', 'buyer_phone', 'address', 'card_message', 'notes', 'delivery_note', 'status', 'delivery', 'pickup'] loop
    if v_new ? k and (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k, v_new->k));
    end if;
  end loop;
  foreach k in array array['photo_path', 'bouquet_path', 'proof_path'] loop
    if (v_old->k) is distinct from (v_new->k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old->k is not null and v_old->>k <> '', v_new->k is not null and v_new->>k <> ''));
    end if;
  end loop;

  if (v_old->>'deleted_at') is null and (v_new->>'deleted_at') is not null then
    v_kind := 'trashed'; v_changes := jsonb_build_object('delete_reason', jsonb_build_array(null, v_new->'delete_reason'));
  elsif (v_old->>'deleted_at') is not null and (v_new->>'deleted_at') is null then
    v_kind := 'untrashed'; v_changes := jsonb_build_object('delete_reason', jsonb_build_array(v_old->'delete_reason', null));
  elsif old.cancelled_at is null and new.cancelled_at is not null then
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

-- ---------- requests: which order they became, and what happened to it ----------
alter table public.cdf_order_requests add column accepted_order_num text;
create function public.cdf_request_keep_num() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.accepted_order_id is not null and (tg_op = 'INSERT' or new.accepted_order_id is distinct from old.accepted_order_id) then
    new.accepted_order_num := coalesce((select o.num from public.cdf_orders o where o.id = new.accepted_order_id), new.accepted_order_num);
  end if;
  return new;
end $$;
revoke all on function public.cdf_request_keep_num() from public, anon, authenticated;
create trigger cdf_order_requests_keep_num before insert or update of accepted_order_id on public.cdf_order_requests
  for each row execute function public.cdf_request_keep_num();
-- Existing ones: the order's number, or (order already deleted, like R2 → #0007) the one noted when accepted
update public.cdf_order_requests q set accepted_order_num = coalesce(
    (select o.num from public.cdf_orders o where o.id = q.accepted_order_id),
    (select e.detail->>'num' from public.cdf_request_events e where e.request_id = q.id and e.kind = 'accepted' order by e.created_at desc limit 1))
where q.status = 'accepted' and q.accepted_order_num is null;

-- The order a request became: there, in the trash, or deleted (with who, when and why when the log has it)
create function public.cdf_request_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.cdf_order_requests; o public.cdf_orders; a public.cdf_order_audit; v_order uuid;
begin
  if not public.cdf_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into q from public.cdf_order_requests where id = p_id;
  if not found or q.status <> 'accepted' then return null; end if;
  if q.accepted_order_id is not null then
    select * into o from public.cdf_orders where id = q.accepted_order_id;
    if found then
      return jsonb_build_object('state', case when o.deleted_at is null then 'active' else 'trash' end, 'order_id', o.id, 'num', o.num,
        'at', o.deleted_at, 'by', o.deleted_by, 'reason', o.delete_reason);
    end if;
  end if;
  -- Gone: the order id from the accept entry, then the delete in the log (none for deletes before this change)
  v_order := coalesce(q.accepted_order_id,
    (select (e.detail->>'order_id')::uuid from public.cdf_request_events e where e.request_id = q.id and e.kind = 'accepted' order by e.created_at desc limit 1));
  -- (the purge also notes the request in its snapshot, which covers requests without an accept entry)
  select * into a from public.cdf_order_audit where action = 'purged'
    and (order_id = v_order or (snapshot->'request'->>'id')::uuid = q.id) order by at desc limit 1;
  return jsonb_build_object('state', 'deleted', 'num', q.accepted_order_num, 'at', a.at, 'by', a.by_email, 'reason', a.reason, 'logged', a.id is not null);
end $$;
revoke all on function public.cdf_request_order(uuid) from public, anon;
grant execute on function public.cdf_request_order(uuid) to authenticated;

-- Exact counts for the Requests tab (status bucket × type), whatever the panel has loaded
create function public.cdf_request_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.cdf_is_admin() then coalesce(jsonb_object_agg(k, n), '{}'::jsonb) end from (
    select (case when status in ('received', 'in_review') then 'open' when status = 'accepted' then 'accepted' else 'rejected' end) || ':' || mode as k, count(*) as n
    from public.cdf_order_requests group by 1) c
$$;
revoke all on function public.cdf_request_counts() from public, anon;
grant execute on function public.cdf_request_counts() to authenticated;

-- ---------- type: orders made from a pickup request are pickups ----------
-- From the request itself only (never from a missing address); not for one already on its way (it went out).
update public.cdf_orders o set pickup = true
from public.cdf_order_requests q
where q.accepted_order_id = o.id and q.mode = 'pickup' and not o.pickup and o.delivery <> 'In transit';
