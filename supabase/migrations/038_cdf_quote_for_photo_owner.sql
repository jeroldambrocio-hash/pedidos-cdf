-- 9/11/2026, audit fixes.
-- 1) What each Lalamove price was made for (florist, shop, day, slot, pickup time). Booking refuses a price
--    whose order changed since (cdf-lalamove), and the panel asks for a new one.
alter table public.cdf_lalamove add column quote_for jsonb;

-- 2) Photos under an order's folder (extra photos and delivery proofs share cdf-entregas): a florist may only
--    delete the ones she uploaded herself; the office's reference photos stay. Staff keep full access.
drop policy if exists cdf_entregas_progress_delete on storage.objects;
create policy cdf_entregas_progress_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cdf-entregas' and public.cdf_can_progress_path(name) and owner_id = (select auth.uid())::text);
