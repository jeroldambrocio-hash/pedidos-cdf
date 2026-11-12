-- 12/11/2026. The panel lists an order's Lalamove proofs with who removed one (removed_by, shown as
-- "Removed by …"), but that column was left out of what signed-in users may read (migration 20261111130000).
-- The whole list query then failed and the panel hid the proofs block, so no proof photo was visible.
-- Same readers as the other columns (admins and the order's florist, by the existing row policy).
grant select (removed_by) on public.cdf_lalamove_proofs to authenticated;
