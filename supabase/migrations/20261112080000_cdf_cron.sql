-- 12/11/2026. Turn on pg_cron so what failed the first time is retried on its own, every five minutes,
-- instead of waiting for the next request or Lalamove event:
--  · cdf-outbox-retry   notices to the admins' phones that did not get through (Phase 3)
--  · cdf-lalamove-work  Lalamove events that could not be processed, running deliveries read back,
--                       proofs still to download (Phase 5)
-- Where the extension is not available (the throwaway test database) nothing happens.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('cdf-outbox-retry', '*/5 * * * *', 'select public.cdf_outbox_retry()');
    perform cron.schedule('cdf-lalamove-work', '*/5 * * * *', 'select public.cdf_lalamove_work_hook()');
  end if;
end $$;
