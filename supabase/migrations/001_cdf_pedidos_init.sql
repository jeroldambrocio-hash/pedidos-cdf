-- Pedidos CDF (flower orders). Everything prefixed cdf_; independent of rentrooms tables.
create table public.cdf_members (
  email text primary key check (email = lower(email)),
  name text not null,
  role text not null check (role in ('admin','vendor')),
  created_at timestamptz not null default now()
);

create table public.cdf_orders (
  id uuid primary key default gen_random_uuid(),
  num text not null unique,
  date date not null,
  slot text not null,
  channel text not null,
  notes text not null default '',
  vendor_email text references public.cdf_members(email) on update cascade on delete set null,
  status text not null default 'Preparing' check (status in ('Preparing','Ready')),
  delivery text not null default '-' check (delivery in ('-','In transit','Delivered')),
  photo_path text,
  code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cdf_orders_date_idx on public.cdf_orders(date);
create index cdf_orders_vendor_idx on public.cdf_orders(vendor_email);

create function public.cdf_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger cdf_orders_touch before update on public.cdf_orders for each row execute function public.cdf_touch();

create function public.cdf_my_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.cdf_members where email = lower(coalesce(auth.jwt()->>'email',''))
$$;
create function public.cdf_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.cdf_my_role() = 'admin', false)
$$;

alter table public.cdf_members enable row level security;
alter table public.cdf_orders enable row level security;

create policy cdf_members_read on public.cdf_members for select to authenticated
  using (public.cdf_is_admin() or email = lower(auth.jwt()->>'email'));
create policy cdf_members_admin_write on public.cdf_members for all to authenticated
  using (public.cdf_is_admin()) with check (public.cdf_is_admin());

create policy cdf_orders_admin on public.cdf_orders for all to authenticated
  using (public.cdf_is_admin()) with check (public.cdf_is_admin());
create policy cdf_orders_vendor_read on public.cdf_orders for select to authenticated
  using (vendor_email = lower(auth.jwt()->>'email') and public.cdf_my_role() = 'vendor');

-- Public tracking: only by secret code, only customer-safe fields.
create function public.cdf_track(p_code text)
returns table(num text, date date, slot text, status text, delivery text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.num, o.date, o.slot, o.status, o.delivery, o.updated_at
  from public.cdf_orders o where o.code = p_code and length(p_code) >= 8
$$;
revoke all on function public.cdf_track(text) from public;
grant execute on function public.cdf_track(text) to anon, authenticated;

-- Photos: private bucket, path = <order id>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cdf-fotos','cdf-fotos', false, 3145728, array['image/jpeg','image/png','image/webp']);

create policy cdf_fotos_admin on storage.objects for all to authenticated
  using (bucket_id = 'cdf-fotos' and public.cdf_is_admin())
  with check (bucket_id = 'cdf-fotos' and public.cdf_is_admin());
create policy cdf_fotos_vendor_read on storage.objects for select to authenticated
  using (bucket_id = 'cdf-fotos' and exists (
    select 1 from public.cdf_orders o
    where o.photo_path = storage.objects.name and o.vendor_email = lower(auth.jwt()->>'email')));

alter publication supabase_realtime add table public.cdf_orders;

insert into public.cdf_members(email, name, role) values ('jeroldambrocio@gmail.com','Jerold','admin');
