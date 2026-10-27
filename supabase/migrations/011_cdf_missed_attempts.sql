-- Keep a trace of "nobody home" so the admin sees it after the order moves to its new date:
-- attempts counts failed visits, missed_on is the day of the last failed visit, missed_at when it happened.
alter table public.cdf_orders
  add column attempts int not null default 0,
  add column missed_on date,
  add column missed_at timestamptz;

create or replace function public.cdf_reschedule(p_id uuid, p_date date, p_slot text, p_note text default null,
  p_proof text default null, p_set_proof boolean default false)
returns public.cdf_orders language plpgsql security definer set search_path = '' as $$
declare r public.cdf_orders;
begin
  if not public.cdf_can_progress(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null or coalesce(p_slot, '') !~ '^\d{1,2}:\d{2} - \d{1,2}:\d{2}$' then
    raise exception 'bad date or slot' using errcode = '22023';
  end if;
  if p_set_proof and p_proof is not null and split_part(p_proof, '/', 1) <> p_id::text then
    raise exception 'bad proof path' using errcode = '22023';
  end if;
  update public.cdf_orders set
    status = 'Ready', delivery = '-',
    missed_on = date, missed_at = now(), attempts = attempts + 1,
    date = p_date, slot = p_slot,
    delivery_note = coalesce(left(p_note, 1000), delivery_note),
    proof_path = case when p_set_proof then p_proof else proof_path end
  where id = p_id returning * into r;
  return r;
end $$;

-- The two orders rescheduled before this existed
update public.cdf_orders set attempts = 1, missed_on = (updated_at at time zone 'Asia/Manila')::date, missed_at = updated_at
where attempts = 0 and delivery_note like 'We came at % but nobody was home.%';
