-- 003: hardening from the 2026-10-29 review (see docs/decisions.md, 2026-10-30).

-- TRUNCATE is not covered by row-level triggers, so guard it separately.
create function prevent_truncate() returns trigger language plpgsql as $$
begin
  raise exception '% cannot be truncated', tg_table_name;
end $$;

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function prevent_truncate();

create trigger employee_no_truncate
  before truncate on employee
  for each statement execute function prevent_truncate();

-- A leave quota can never be set below its statutory floor (R4, R8).
alter table leave_type
  add constraint leave_type_quota_meets_floor
  check (annual_quota is null or statutory_floor is null or annual_quota >= statutory_floor);

-- Minimum-privilege role for the app. No login of its own: the owner creates a login role in the
-- Neon console and runs `grant hrms_app to <that role>`. Future migrations must grant privileges
-- on any new table here explicitly.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hrms_app') then
    create role hrms_app nologin;
  end if;
end $$;

revoke all on all tables in schema public from hrms_app;
revoke all on all sequences in schema public from hrms_app;
grant usage on schema public to hrms_app;

grant select on location, employee, employment_assignment, employee_role, leave_type,
  leave_request, holiday, attendance_day, audit_log to hrms_app;
grant insert, update on location, employee, employment_assignment, leave_type,
  leave_request, holiday, attendance_day to hrms_app;
grant insert, delete on employee_role to hrms_app;
grant insert on audit_log to hrms_app;          -- append only: no update, delete or truncate
grant usage, select on sequence employee_code_seq to hrms_app;
