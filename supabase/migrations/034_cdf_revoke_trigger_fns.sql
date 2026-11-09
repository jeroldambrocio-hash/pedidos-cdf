-- Security tidy-up (9/11/2026, Supabase advisor): the push trigger functions only run from their triggers;
-- nobody should be able to call them through the API.
revoke execute on function public.cdf_push_assigned() from public, anon, authenticated;
revoke execute on function public.cdf_push_message() from public, anon, authenticated;
