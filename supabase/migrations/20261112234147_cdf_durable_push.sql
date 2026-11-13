-- F08: every push event is durable, including chats, assignments, cancellations and riders.
-- A delivery acknowledgement closes it; transient failures retry indefinitely with bounded backoff.
-- Only identifiers and routing data are retained here, never message text or customer details.
alter table public.cdf_outbox
  add column payload jsonb,
  add column next_attempt_at timestamptz not null default now(),
  add column last_error text;

create or replace function public.cdf_outbox_send(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_outbox%rowtype;
begin
  update public.cdf_outbox
    set attempts = least(attempts, 2147483646) + 1, last_attempt_at = now(),
        next_attempt_at = now() + make_interval(secs => least(3600, 120 * power(2, least(attempts, 5)))::integer),
        last_error = null
    where id = p_id and delivered_at is null and next_attempt_at <= now()
    returning * into r;
  if not found then return; end if;
  begin
    perform public.cdf_push_hook(
      coalesce(r.payload, jsonb_build_object('kind', r.kind, 'id', r.ref_id))
        || jsonb_build_object('outbox', r.id));
  exception when others then
    -- Keep the event even if pg_net itself cannot enqueue the HTTP call.
    update public.cdf_outbox set last_error = 'dispatch_failed:' || SQLSTATE where id = r.id;
    raise warning 'cdf push dispatch failed for outbox %, SQLSTATE %', r.id, SQLSTATE;
  end;
end $$;

create or replace function public.cdf_push_hook(p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_id bigint;
begin
  if p_body ? 'outbox' then
    -- Only the dispatcher enters here. Original triggers enter through the durable branch below.
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
    if v_secret is null then raise exception 'cdf_push_secret_missing'; end if;
    perform net.http_post(
      url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
      body := p_body);
  else
    if coalesce(p_body->>'kind', '') not in
      ('message','direct','assigned','cancelled','rider','rider_failed','request','request_expired')
      or p_body->>'id' is null then raise exception 'cdf_push_invalid'; end if;
    insert into public.cdf_outbox(kind, ref_id, payload)
      values (p_body->>'kind', (p_body->>'id')::uuid,
        jsonb_strip_nulls(jsonb_build_object('kind', p_body->>'kind', 'id', p_body->>'id',
          'to', p_body->>'to', 'status', p_body->>'status')))
      returning id into v_id;
    perform public.cdf_outbox_send(v_id);
  end if;
end $$;

-- No attempt cap. Old rows that exhausted five tries become due again after this migration.
update public.cdf_outbox set next_attempt_at = coalesce(last_attempt_at, created_at) + interval '2 minutes'
where delivered_at is null;
create index cdf_outbox_due on public.cdf_outbox(next_attempt_at, id) where delivered_at is null;

create or replace function public.cdf_outbox_retry() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_n integer := 0;
begin
  for v_id in select id from public.cdf_outbox
    where delivered_at is null and next_attempt_at <= now()
    order by next_attempt_at, id limit 20 for update skip locked loop
    perform public.cdf_outbox_send(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Safe operational visibility: no payloads, addresses or endpoints.
create function public.cdf_outbox_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.cdf_is_admin() then (
    select jsonb_build_object('pending', count(*),
      'over_five_attempts', count(*) filter (where attempts >= 5),
      'oldest_at', min(created_at), 'next_attempt_at', min(next_attempt_at),
      'dispatch_errors', count(*) filter (where last_error is not null))
    from public.cdf_outbox where delivered_at is null
  ) else null end
$$;
revoke all on function public.cdf_push_hook(jsonb), public.cdf_outbox_send(bigint),
  public.cdf_outbox_retry(), public.cdf_outbox_health() from public, anon, authenticated;
grant execute on function public.cdf_push_hook(jsonb), public.cdf_outbox_send(bigint),
  public.cdf_outbox_retry() to service_role;
grant execute on function public.cdf_outbox_health() to authenticated, service_role;

