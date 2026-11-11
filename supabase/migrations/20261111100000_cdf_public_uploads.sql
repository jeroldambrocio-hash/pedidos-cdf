-- 11/11/2026. Phase 2: what the public order form needs on the server before any request exists.
-- Additive only: three tables, six functions and one private bucket. Nothing existing is touched.
-- None of it is reachable from a browser: visitors and signed-in staff have no rights on these tables or
-- functions. Only the edge function cdf-public-order (service role) uses them.

-- 1) An upload session: what a visitor gets after passing the anti-abuse check. It carries the quotas.
--    The token itself is never stored, only its hash; the address is stored hashed too.
create table public.cdf_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  submitted_at timestamptz
);

-- 2) Files sent with a request: reference photos and one declared payment proof. A row is "pending" while
--    the upload is being checked and "ready" once it passed; only ready files can be attached to a request.
--    (Phase 3 links them to the request; a proof here never changes what an order has been paid.)
create table public.cdf_request_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cdf_upload_sessions(id) on delete cascade,
  kind text not null check (kind in ('reference', 'payment_proof')),
  path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected', 'removed')),
  mime text, bytes integer, width integer, height integer, sha256 text,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index cdf_request_files_session on public.cdf_request_files(session_id);

-- 3) Request counting shared by every instance of the function (memory in one instance is not a limit).
create table public.cdf_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.cdf_upload_sessions enable row level security;
alter table public.cdf_request_files enable row level security;
alter table public.cdf_rate_limits enable row level security;
revoke all on public.cdf_upload_sessions, public.cdf_request_files, public.cdf_rate_limits from public, anon, authenticated;
grant all on public.cdf_upload_sessions, public.cdf_request_files, public.cdf_rate_limits to service_role;

-- One more hit in this bucket's current window; false once it goes over the limit.
create function public.cdf_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_bucket is null or p_limit is null or coalesce(p_window_seconds, 0) < 1 then raise exception 'cdf_invalid_limit'; end if;
  insert into public.cdf_rate_limits as r (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if random() < 0.02 then delete from public.cdf_rate_limits where window_start < now() - interval '1 day'; end if;
  return v_hits <= p_limit;
end $$;

create function public.cdf_upload_session_open(p_token_hash text, p_ip_hash text) returns uuid
language sql set search_path = '' as $$
  insert into public.cdf_upload_sessions(token_hash, ip_hash) values (p_token_hash, p_ip_hash) returning id
$$;

-- The live session behind a token, or null (unknown, expired or already used for a request).
create function public.cdf_upload_session_of(p_token_hash text) returns uuid
language sql stable set search_path = '' as $$
  select id from public.cdf_upload_sessions
  where token_hash = p_token_hash and expires_at > now() and submitted_at is null
$$;

-- Reserve a place for one file. The session row is locked, so two uploads arriving together cannot both
-- take the last place. At most six reference photos and one payment proof per session.
create function public.cdf_upload_claim(p_token_hash text, p_kind text, p_ext text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_session uuid;
  v_file uuid := gen_random_uuid();
  v_path text;
begin
  select id into v_session from public.cdf_upload_sessions
  where token_hash = p_token_hash and expires_at > now() and submitted_at is null for update;
  if v_session is null then raise exception 'cdf_session_invalid'; end if;
  if p_kind not in ('reference', 'payment_proof') or p_ext not in ('jpg', 'png', 'webp') then raise exception 'cdf_invalid_file'; end if;
  if (select count(*) from public.cdf_request_files where session_id = v_session and kind = p_kind and status in ('pending', 'ready'))
    >= (case p_kind when 'reference' then 6 else 1 end) then raise exception 'cdf_upload_quota'; end if;
  -- Every attempt counts, also failed ones, so a session cannot be used to push files without end
  if (select count(*) from public.cdf_request_files where session_id = v_session) >= 30 then raise exception 'cdf_upload_quota'; end if;
  v_path := v_session::text || '/' || v_file::text || '.' || p_ext;
  insert into public.cdf_request_files(id, session_id, kind, path) values (v_file, v_session, p_kind, v_path);
  return jsonb_build_object('file', v_file, 'path', v_path);
end $$;

-- The outcome of checking and storing a claimed file; also how a visitor takes one back (p_status 'removed').
create function public.cdf_upload_finish(p_token_hash text, p_file uuid, p_status text,
  p_mime text, p_bytes integer, p_width integer, p_height integer, p_sha256 text) returns text
language plpgsql set search_path = '' as $$
declare v_path text;
begin
  if p_status not in ('ready', 'rejected', 'removed') then raise exception 'cdf_invalid_file'; end if;
  update public.cdf_request_files f
  set status = p_status, checked_at = now(), mime = coalesce(p_mime, f.mime), bytes = coalesce(p_bytes, f.bytes),
      width = coalesce(p_width, f.width), height = coalesce(p_height, f.height), sha256 = coalesce(p_sha256, f.sha256)
  from public.cdf_upload_sessions s
  where f.id = p_file and s.id = f.session_id and s.token_hash = p_token_hash and s.submitted_at is null
    and ((p_status = 'removed' and f.status in ('pending', 'ready')) or (p_status <> 'removed' and f.status = 'pending'))
  returning f.path into v_path;
  if v_path is null then raise exception 'cdf_invalid_file'; end if;
  return v_path;
end $$;

-- Are all these files ready, of the stated kinds, and from this session? (What a request may attach.)
create function public.cdf_upload_files_ready(p_token_hash text, p_references uuid[], p_proof uuid) returns boolean
language sql stable set search_path = '' as $$
  select s.id is not null
    and cardinality(coalesce(p_references, '{}')) <= 6
    and cardinality(coalesce(p_references, '{}')) = (select count(distinct f.id) from public.cdf_request_files f
      where f.session_id = s.id and f.kind = 'reference' and f.status = 'ready' and f.id = any (coalesce(p_references, '{}')))
    and (p_proof is null or exists (select 1 from public.cdf_request_files f
      where f.session_id = s.id and f.kind = 'payment_proof' and f.status = 'ready' and f.id = p_proof))
  from (select 1) one
  left join public.cdf_upload_sessions s on s.token_hash = p_token_hash and s.expires_at > now() and s.submitted_at is null
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.cdf_rate_hit(text, integer, integer)', 'public.cdf_upload_session_open(text, text)',
    'public.cdf_upload_session_of(text)', 'public.cdf_upload_claim(text, text, text)',
    'public.cdf_upload_finish(text, uuid, text, text, integer, integer, integer, text)',
    'public.cdf_upload_files_ready(text, uuid[], uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- 4) Where those files live until a request is accepted or expires. Private, images only, 3 MiB each.
--    No storage policy is added: without one, neither visitors nor staff sessions can list, read or write
--    it. Only the service role can (Phase 3 hands admins short-lived links, as the other buckets do).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-solicitudes', 'cdf-solicitudes', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
