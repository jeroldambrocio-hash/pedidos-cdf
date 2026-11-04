-- The tracking page uses the cdf-track edge function; the old public RPC is no longer called.
revoke execute on function public.cdf_track(text) from anon, public;
