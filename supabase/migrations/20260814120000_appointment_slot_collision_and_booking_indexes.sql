-- Appointment booking integrity: one slot-blocking appointment per dietitian.
-- `upcoming` is the only canonical slot-blocking status. `completed` and
-- `cancelled` remain reusable historical/non-blocking states.

do $$
begin
  if exists (
    select 1
    from public.appointments
    where status = 'upcoming'
    group by dietitian_id, date, time
    having count(*) > 1
  ) then
    raise exception 'appointments üzerinde mevcut upcoming tarih/saat çakışmaları var; unique index oluşturulamaz.';
  end if;
end
$$;

create unique index appointments_dietitian_date_time_upcoming_unique
  on public.appointments (dietitian_id, date, time)
  where status = 'upcoming';

create index appointments_dietitian_client_status_date_idx
  on public.appointments (dietitian_id, client_id, status, date);
