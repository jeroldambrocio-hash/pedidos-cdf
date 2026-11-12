-- 12/11/2026. Requests nobody handled in time, and how long what customers sent is kept.
--  · A request still "new" or "in review" when its delivery day has passed (Manila time) becomes
--    "expired", and every admin's phone hears it (no personal data in the notice).
--  · Rejected and expired requests are deleted 90 days after they were closed, with their photos and
--    payment proof. Accepted ones stay: they are orders now.
--  · Photos uploaded in a form that was never sent are deleted a day after the session ended.
-- The files are removed by the cdf-public-order function (the database cannot delete stored files); this
-- migration lists them and deletes the rows once the files are gone. Additive; nothing existing changes
-- except one check (a request's history may now say "expired").

alter table public.cdf_request_events drop constraint cdf_request_events_kind_check;
alter table public.cdf_request_events add constraint cdf_request_events_kind_check
  check (kind in ('received', 'opened', 'rejected', 'reopened', 'accepted', 'expired'));

-- 1) Expire what was left unanswered past its day. Returns how many.
create function public.cdf_requests_expire() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_row record; v_n integer := 0; v_outbox bigint;
begin
  for v_row in
    update public.cdf_order_requests set status = 'expired', updated_at = now(), version = version + 1
    where status in ('received', 'in_review') and date < (now() at time zone 'Asia/Manila')::date
    returning id
  loop
    insert into public.cdf_request_events (request_id, kind) values (v_row.id, 'expired');
    insert into public.cdf_outbox (kind, ref_id) values ('request_expired', v_row.id) returning id into v_outbox;
    perform public.cdf_outbox_send(v_outbox);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 2) What can go is first reserved, and the reservation is kept until the files are really gone
--    (reviewed 12/11/2026: without it an admin could reopen an old rejected request between the listing and
--    the deletion, and end up with a live request whose photos were deleted). A reserved request can no
--    longer be reopened or accepted, and a reserved file can no longer be attached to a request; if the
--    storage fails, the reservation stays and the next round finishes the job.
alter table public.cdf_order_requests add column purge_claimed_at timestamptz;
alter table public.cdf_request_files add column purge_claimed_at timestamptz;

create function public.cdf_guard_request_purge() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.purge_claimed_at is not null then
    if tg_table_name = 'cdf_order_requests' and (new.status is distinct from old.status or new.purge_claimed_at is null) then
      raise exception 'cdf_request_closed' using detail = 'being deleted';
    end if;
    if tg_table_name = 'cdf_request_files' and (new.request_id is distinct from old.request_id or new.purge_claimed_at is null) then
      raise exception 'cdf_request_closed' using detail = 'being deleted';
    end if;
  end if;
  return new;
end $$;
create trigger cdf_order_requests_purge_guard before update on public.cdf_order_requests
  for each row execute function public.cdf_guard_request_purge();
create trigger cdf_request_files_purge_guard before update on public.cdf_request_files
  for each row execute function public.cdf_guard_request_purge();
revoke all on function public.cdf_guard_request_purge() from public, anon, authenticated;

--    Reserve, then list: requests closed (rejected or expired) more than 90 days ago, and files of sessions
--    that ended a day ago without being sent. Returns the paths reserved (old reservations included), for the
--    function to delete. Row locks make a reopen/accept at the same moment either win (the request is then
--    not reserved) or wait and be refused.
create function public.cdf_requests_purge_claim(p_limit integer) returns table (path text)
language plpgsql security definer set search_path = '' as $$
begin
  update public.cdf_order_requests r set purge_claimed_at = now()
  where r.purge_claimed_at is null and r.status in ('rejected', 'expired') and r.updated_at < now() - interval '90 days';
  update public.cdf_request_files f set purge_claimed_at = now()
  where f.purge_claimed_at is null and f.request_id is null and f.session_id is not null
    and not exists (select 1 from public.cdf_upload_sessions s where s.id = f.session_id and s.expires_at >= now() - interval '1 day');
  update public.cdf_request_files f set purge_claimed_at = now()
  where f.purge_claimed_at is null and f.request_id is null and f.session_id is null;
  update public.cdf_request_files f set purge_claimed_at = now()
  from public.cdf_order_requests r
  where f.purge_claimed_at is null and r.id = f.request_id and r.purge_claimed_at is not null;
  return query
    select f.path from public.cdf_request_files f where f.purge_claimed_at is not null
    order by f.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- 3) Once the files are gone: their rows, the reserved requests left with no files (their history goes with
--    them) and the sessions left with nothing. Only reserved rows are ever deleted. Returns what was deleted.
create function public.cdf_requests_purge(p_paths text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_files integer; v_requests integer; v_sessions integer;
begin
  delete from public.cdf_request_files where path = any (coalesce(p_paths, '{}')) and purge_claimed_at is not null;
  get diagnostics v_files = row_count;
  delete from public.cdf_order_requests r
  where r.purge_claimed_at is not null
    and not exists (select 1 from public.cdf_request_files f where f.request_id = r.id);
  get diagnostics v_requests = row_count;
  delete from public.cdf_upload_sessions s
  where s.expires_at < now() - interval '1 day'
    and not exists (select 1 from public.cdf_request_files f where f.session_id = s.id)
    and not exists (select 1 from public.cdf_order_requests r where r.session_id = s.id);
  get diagnostics v_sessions = row_count;
  return jsonb_build_object('files', v_files, 'requests', v_requests, 'sessions', v_sessions);
end $$;

-- 4) The daily round: expire, then ask the function to delete what can go.
create function public.cdf_requests_cleanup_hook() returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  perform public.cdf_requests_expire();
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cdf_hook_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1/cdf-public-order',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cdf-hook', v_secret),
    body := jsonb_build_object('action', 'cleanup'));
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['public.cdf_requests_expire()', 'public.cdf_requests_purge_claim(integer)',
    'public.cdf_requests_purge(text[])', 'public.cdf_requests_cleanup_hook()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- Every day at 16:05 UTC (00:05 in Manila, right after the day changes), where pg_cron exists
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cdf-requests-cleanup', '5 16 * * *', 'select public.cdf_requests_cleanup_hook()');
  end if;
end $$;
