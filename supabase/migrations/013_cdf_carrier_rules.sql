-- Server-side rules for the delivery flow (needs 012 first: it reads archived_at).
-- 1) Each order can have its driver: carrier_email. A driver who takes an order out claims it.
-- 2) Drivers only see what they still have to deliver (plus what they delivered today/yesterday),
--    unassigned or assigned to them, instead of every order that ever was Ready.
-- 3) Florists and drivers can only move an order along the real flow (no Preparing -> Delivered jumps),
--    and "nobody home" can only be recorded for an order that was out for delivery.

alter table public.cdf_orders add column carrier_email text references public.cdf_members(email) on update cascade on delete set null;
create index cdf_orders_carrier_idx on public.cdf_orders (carrier_email);

-- What a driver may see of an order
create function public.cdf_carrier_sees(p_status text, p_delivery text, p_date date, p_carrier text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_status = 'Ready'
    and (p_carrier is null or p_carrier = lower(coalesce(auth.jwt()->>'email', '')))
    and (p_delivery <> 'Delivered' or p_date >= (now() at time zone 'Asia/Manila')::date - 1)
$$;

-- The step an order is on, and the moves florists and drivers may make from it
create function public.cdf_step_of(p_status text, p_delivery text) returns text
language sql immutable set search_path = '' as $$
  select case when p_delivery = 'Failed' then 'fail' when p_delivery = 'Delivered' then 'done'
    when p_delivery = 'In transit' then 'transit' when p_status = 'Ready' then 'ready' else 'prep' end
$$;
create function public.cdf_step_ok(p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select p_from = p_to or (p_from, p_to) in (('prep', 'ready'), ('ready', 'prep'), ('ready', 'transit'), ('transit', 'ready'),
    ('transit', 'done'), ('transit', 'fail'), ('fail', 'transit'), ('fail', 'ready'))
$$;
revoke all on function public.cdf_carrier_sees(text, text, date, text), public.cdf_step_of(text, text), public.cdf_step_ok(text, text) from public, anon;
grant execute on function public.cdf_carrier_sees(text, text, date, text), public.cdf_step_of(text, text), public.cdf_step_ok(text, text) to authenticated;

create or replace function public.cdf_can_progress(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.cdf_is_staff() or exists (
    select 1 from public.cdf_orders o
    where o.id = p_id and o.archived_at is null and (
      (public.cdf_my_role() = 'vendor' and o.vendor_email = lower(coalesce(auth.jwt()->>'email', '')))
      or (public.cdf_my_role() = 'carrier' and public.cdf_carrier_sees(o.status, o.delivery, o.date, o.carrier_email))))
$$;

drop policy cdf_orders_carrier_read on public.cdf_orders;
create policy cdf_orders_carrier_read on public.cdf_orders for select to authenticated
  using (public.cdf_my_role() = 'carrier' and archived_at is null and public.cdf_carrier_sees(status, delivery, date, carrier_email));

drop policy cdf_fotos_carrier_read on storage.objects;
create policy cdf_fotos_carrier_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-fotos' and public.cdf_my_role() = 'carrier' and exists (
    select 1 from public.cdf_orders o where o.photo_path = storage.objects.name and o.archived_at is null
      and public.cdf_carrier_sees(o.status, o.delivery, o.date, o.carrier_email)));

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
  case p_step
    when 'prep' then v_status := 'Preparing'; v_delivery := '-';
    when 'ready' then v_status := 'Ready'; v_delivery := '-';
    when 'transit' then v_status := 'Ready'; v_delivery := 'In transit';
    when 'done' then v_status := 'Ready'; v_delivery := 'Delivered';
    when 'fail' then v_status := 'Ready'; v_delivery := 'Failed';
    else raise exception 'bad step' using errcode = '22023';
  end case;
  if v_role = 'carrier' and p_step not in ('transit', 'done', 'fail') then
    raise exception 'carriers can only set In transit, Delivered or Failed' using errcode = '42501';
  end if;
  if not public.cdf_is_staff() and not public.cdf_step_ok(public.cdf_step_of(r.status, r.delivery), p_step) then
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

create or replace function public.cdf_reschedule(p_id uuid, p_date date, p_slot text, p_note text default null,
  p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null or coalesce(p_slot, '') !~ '^\d{1,2}:\d{2} - \d{1,2}:\d{2}$' then
    raise exception 'bad date or slot' using errcode = '22023';
  end if;
  select * into r from public.cdf_orders where id = p_id for update;
  if r.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.cdf_is_staff() and public.cdf_step_of(r.status, r.delivery) not in ('transit', 'fail') then
    raise exception 'only an order out for delivery can be rescheduled' using errcode = '22023';
  end if;
  if not public.cdf_is_staff() and p_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'the new date is in the past' using errcode = '22023';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = 'Ready', delivery = '-',
    missed_on = date, missed_at = now(), attempts = attempts + 1,
    date = p_date, slot = p_slot,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end
  where id = p_id returning * into r;
  return r;
end $$;
