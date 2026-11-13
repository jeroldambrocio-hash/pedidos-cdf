-- Durable automatic emails (audit E06 / S01, from docs/audit-durable-email.sql).
-- Applied to production on 13/11/2026, after cdf-notify v24 (which confirms the outbox) was deployed.
-- Reuses the existing private outbox and five-minute retry job. No old email
-- is replayed; only future trigger events enter the queue.
-- An email is tried at most 3 times (owner's decision, 13/11/2026): after the third
-- failed attempt the row is closed with last_error = 'email_gave_up_after_3_attempts'.
-- Push notices keep their own retry rules.

create or replace function public.cdf_outbox_send(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.cdf_outbox%rowtype; v_secret text;
begin
  update public.cdf_outbox
    set delivered_at = now(), last_error = 'email_gave_up_after_3_attempts'
    where id = p_id and kind = 'email' and delivered_at is null and attempts >= 3 and next_attempt_at <= now();
  if found then return; end if;
  update public.cdf_outbox
    set attempts = least(attempts, 2147483646) + 1, last_attempt_at = now(),
        next_attempt_at = now() + make_interval(secs => least(3600, 120 * power(2, least(attempts, 5)))::integer),
        last_error = null
    where id = p_id and delivered_at is null and next_attempt_at <= now()
    returning * into r;
  if not found then return; end if;
  begin
    if r.kind = 'email' then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
      if v_secret is null then raise exception 'cdf_email_secret_missing'; end if;
      perform net.http_post(
        url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-notify',
        headers := jsonb_build_object('Content-Type','application/json','x-cdf-hook',v_secret),
        body := r.payload || jsonb_build_object('order_id',r.ref_id,'outbox',r.id));
    else
      perform public.cdf_push_hook(
        coalesce(r.payload, jsonb_build_object('kind',r.kind,'id',r.ref_id))
          || jsonb_build_object('outbox',r.id));
    end if;
  exception when others then
    update public.cdf_outbox set last_error = 'dispatch_failed:' || SQLSTATE where id = r.id;
    raise warning 'cdf dispatch failed for outbox %, SQLSTATE %',r.id,SQLSTATE;
  end;
end $$;

create or replace function public.cdf_notify_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if new.vendor_email is null then return new; end if;
  if tg_op = 'UPDATE' and old.vendor_email is not distinct from new.vendor_email then return new; end if;
  if new.vendor_email = lower(coalesce(auth.jwt()->>'email','')) then return new; end if;
  insert into public.cdf_outbox(kind,ref_id,payload)
    values('email',new.id,jsonb_build_object('action','assigned','to',new.vendor_email)) returning id into v_id;
  perform public.cdf_outbox_send(v_id);
  return new;
end $$;

create or replace function public.cdf_notify_transit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if new.delivery <> 'In transit' or old.delivery is not distinct from new.delivery then return new; end if;
  if coalesce(trim(new.customer_email),'') = '' then return new; end if;
  insert into public.cdf_outbox(kind,ref_id,payload)
    values('email',new.id,jsonb_build_object('action','auto_transit')) returning id into v_id;
  perform public.cdf_outbox_send(v_id);
  return new;
end $$;

revoke all on function public.cdf_outbox_send(bigint),public.cdf_notify_assigned(),public.cdf_notify_transit() from public,anon,authenticated;
grant execute on function public.cdf_outbox_send(bigint),public.cdf_notify_assigned(),public.cdf_notify_transit() to service_role;

-- Remove unused table-wide privileges without touching column grants or other apps.
revoke truncate on public.cdf_members,public.cdf_orders,public.cdf_notifications,
  public.cdf_order_events,public.cdf_messages,public.cdf_message_reads,
  public.cdf_message_reactions,public.cdf_push_subs from anon,authenticated;
