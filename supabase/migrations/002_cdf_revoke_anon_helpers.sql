revoke execute on function public.cdf_is_admin() from public, anon;
revoke execute on function public.cdf_my_role() from public, anon;
grant execute on function public.cdf_is_admin() to authenticated;
grant execute on function public.cdf_my_role() to authenticated;
