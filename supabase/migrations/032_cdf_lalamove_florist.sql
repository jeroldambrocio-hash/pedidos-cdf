-- Florists book Lalamove riders for their own orders (9/11/2026): they can read the delivery row of an order
-- assigned to them. Writes still only go through the cdf-lalamove function, which checks the same thing.
create policy cdf_lalamove_florist_read on public.cdf_lalamove for select to authenticated
  using (exists (select 1 from public.cdf_orders o
                 where o.id = cdf_lalamove.order_id and o.vendor_email = lower(auth.jwt()->>'email'))
          and public.cdf_my_role() = 'vendor');
