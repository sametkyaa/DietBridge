begin;

alter table public.measurements
    add column if not exists right_arm numeric,
    add column if not exists left_arm numeric,
    add column if not exists right_calf numeric,
    add column if not exists left_calf numeric;

commit;
