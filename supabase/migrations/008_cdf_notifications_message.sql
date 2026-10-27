-- Keep what was actually sent, so the history shows the subject and text of each notice.
alter table public.cdf_notifications
  add column if not exists subject text not null default '',
  add column if not exists message text not null default '';
