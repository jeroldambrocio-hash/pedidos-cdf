-- Email a team member when an order is assigned to them (new order, or vendor changed).
-- The trigger calls the edge function cdf-notify through pg_net; a secret in Vault proves the call came from here.
create extension if not exists pg_net with schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'cdf_hook_secret', 'Pedidos CDF: trigger -> cdf-notify')
where not exists (select 1 from vault.secrets where name = 'cdf_hook_secret');

create or replace function public.cdf_hook_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cdf_hook_secret' and decrypted_secret = p_secret and length(p_secret) > 0)
$$;
revoke all on function public.cdf_hook_ok(text) from public, anon, authenticated;
grant execute on function public.cdf_hook_ok(text) to service_role;

create or replace function public.cdf_notify_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
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
end $$;
revoke all on function public.cdf_notify_assigned() from public, anon, authenticated;

create trigger cdf_orders_notify after insert or update of vendor_email on public.cdf_orders
  for each row execute function public.cdf_notify_assigned();
