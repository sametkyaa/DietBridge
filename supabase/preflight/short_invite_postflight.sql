-- Read-only. Do not invoke preview/redeem/get RPCs against real user data here.
select count(*) as codes,
  count(*) filter(where short_code is null or short_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$') as invalid_short_codes,
  count(*) filter(where code !~ '^DB(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$') as invalid_legacy_codes,
  count(distinct normalized_short_code) as unique_short_codes
from public.dietitian_invite_codes;
select column_name,is_nullable,column_default,is_generated,generation_expression
from information_schema.columns where table_schema='public' and table_name='dietitian_invite_codes'
and column_name in ('short_code','normalized_short_code');
select indexdef from pg_indexes where schemaname='public' and tablename='dietitian_invite_codes';
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='dietitian_invite_codes';
select has_function_privilege('anon','public.preview_dietitian_invite_code(text)','execute') as anon_preview,
  has_function_privilege('anon','public.redeem_dietitian_invite_code(text)','execute') as anon_redeem,
  has_function_privilege('authenticated','private.generate_short_invite_code()','execute') as client_generator;
