-- Read-only. Expected current production shape: old long-code columns only.
select column_name,data_type,is_nullable,column_default,is_generated,generation_expression
from information_schema.columns where table_schema='public' and table_name='dietitian_invite_codes'
order by ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.dietitian_invite_codes'::regclass;
select indexdef from pg_indexes where schemaname='public' and tablename='dietitian_invite_codes';
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='dietitian_invite_codes';
select pg_get_triggerdef(oid) from pg_trigger
where tgrelid='public.dietitian_invite_codes'::regclass and not tgisinternal;
select count(*) as code_count,min(length(code)) as min_length,max(length(code)) as max_length
from public.dietitian_invite_codes;
select n.nspname,p.proname,pg_get_functiondef(p.oid) from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where
(n.nspname='public' and p.proname in ('get_my_invite_code','rotate_my_invite_code','preview_dietitian_invite_code','redeem_dietitian_invite_code'))
or (n.nspname='private' and p.proname in ('normalize_invite_code','generate_invite_code','invite_rate_limited'));
