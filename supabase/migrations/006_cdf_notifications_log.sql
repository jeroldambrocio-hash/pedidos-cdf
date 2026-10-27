-- History of every notice about an order: vendor emails (written by cdf-notify), customer emails sent
-- from the panel, and WhatsApp/Telegram/Viber/copy messages opened from the panel.
create table public.cdf_notifications (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.cdf_orders(id) on delete cascade,
  audience text not null check (audience in ('vendor', 'customer')),
  channel text not null check (channel in ('email', 'whatsapp', 'telegram', 'viber', 'copy')),
  recipient text not null default '',
  ok boolean not null default true,
  detail text not null default '',
  by_email text,
  created_at timestamptz not null default now()
);
create index cdf_notifications_order_idx on public.cdf_notifications (order_id, created_at desc);

alter table public.cdf_notifications enable row level security;
create policy cdf_notifications_admin_read on public.cdf_notifications for select to authenticated
  using (public.cdf_is_admin());
-- Admins log the messages they open in WhatsApp/Telegram/Viber or copy; emails are logged by the edge function.
create policy cdf_notifications_admin_insert on public.cdf_notifications for insert to authenticated
  with check (public.cdf_is_admin() and audience = 'customer' and channel <> 'email' and by_email = lower(auth.jwt()->>'email'));
