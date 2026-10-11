-- Minimal role/relationship dependencies; note table/trigger/policies below
-- are loaded byte-for-byte from the repository's original notes migration.
-- The chat fixture supplies client_status and approved-role helper.
grant select on public.profiles,public.dietitian_clients to service_role;
