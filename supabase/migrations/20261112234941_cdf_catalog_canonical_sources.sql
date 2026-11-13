-- F09: align five existing function sources with their committed migrations.
-- Reviewed differences are comments or CRLF only; executable statements, permissions and data are unchanged.
-- No SQL-comment stripping in the parity checker: it still compares the complete source.

CREATE OR REPLACE FUNCTION public.cdf_can_progress_path(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.cdf_can_progress(split_part(p_name, '/', 1)::uuid) else false end
$function$
;

CREATE OR REPLACE FUNCTION public.cdf_credit_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_by text := nullif(lower(coalesce(auth.jwt()->>'email', '')), '');
  v_role text := public.cdf_my_role();
begin
  if tg_op = 'INSERT' then
    new.prepared_by := null; new.delivered_by := null;
    if new.status = 'Ready' then new.prepared_by := coalesce(new.vendor_email, v_by); end if;
    if new.delivery = 'Delivered' then new.delivered_by := coalesce(new.carrier_email, v_by); end if;
    return new;
  end if;
  new.prepared_by := old.prepared_by; new.delivered_by := old.delivered_by;
  if new.status = 'Ready' and old.status is distinct from 'Ready' and new.prepared_by is null then
    new.prepared_by := case when v_role = 'vendor' then v_by else coalesce(new.vendor_email, v_by) end;
  elsif new.status is distinct from 'Ready' then
    new.prepared_by := null; -- sent back to Preparing: it will be credited again when it is ready
  end if;
  if new.delivery = 'Delivered' and old.delivery is distinct from 'Delivered' and new.delivered_by is null then
    new.delivered_by := case when v_role = 'carrier' then v_by else coalesce(new.carrier_email, v_by) end;
  elsif new.delivery is distinct from 'Delivered' then
    new.delivered_by := null;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cdf_notify_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret text;
begin
  if new.vendor_email is null then return new; end if;
  if tg_op = 'UPDATE' and old.vendor_email is not distinct from new.vendor_email then return new; end if;
  -- No email when you assign an order to yourself.
  if new.vendor_email = lower(coalesce(auth.jwt()->>'email', '')) then return new; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := jsonb_build_object('order_id', new.id)
  );
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cdf_notify_transit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret text;
begin
  if new.delivery <> 'In transit' or old.delivery is not distinct from new.delivery then return new; end if;
  if coalesce(trim(new.customer_email), '') = '' then return new; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := jsonb_build_object('order_id', new.id, 'action', 'auto_transit')
  );
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cdf_track(p_code text)
 RETURNS TABLE(num text, date date, slot text, status text, delivery text, updated_at timestamp with time zone, delivery_note text, proof_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.num, o.date, o.slot, o.status, o.delivery, o.updated_at, o.delivery_note, o.proof_path
  from public.cdf_orders o where o.code = p_code and length(p_code) >= 8
$function$
;
