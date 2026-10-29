-- 001: foundation schema (decisions: P2 identity, P5 history; see docs/decisions.md)
-- Forward-only. Never edit after it has been applied; add a new numbered file instead.

create extension if not exists btree_gist;

create table location (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  state text not null,
  weekly_off_days smallint[] not null default '{0,6}', -- 0 = Sunday ... 6 = Saturday (placeholder until P1 shifts)
  timezone text not null default 'Asia/Kolkata'
);

create sequence employee_code_seq start 1;

create table employee (
  id uuid primary key default gen_random_uuid(),
  -- Placeholder format. Existing employees keep their own codes at import (P6, R29).
  employee_code text not null unique
    default ('KCF' || lpad(nextval('employee_code_seq')::text, 4, '0')),
  full_name text not null,
  work_email text not null,
  date_of_birth date,
  gender text check (gender in ('female', 'male', 'other')),
  joining_date date not null,
  exit_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  clerk_user_id text unique,
  created_at timestamptz not null default now(),
  check (exit_date is null or exit_date >= joining_date)
);

create unique index employee_work_email_key on employee (lower(work_email));

create function prevent_employee_code_change() returns trigger language plpgsql as $$
begin
  if new.employee_code is distinct from old.employee_code then
    raise exception 'employee_code is immutable';
  end if;
  return new;
end $$;

create trigger employee_code_immutable
  before update on employee
  for each row execute function prevent_employee_code_change();

create function prevent_row_delete() returns trigger language plpgsql as $$
begin
  raise exception 'rows in % cannot be deleted', tg_table_name;
end $$;

create trigger employee_no_delete
  before delete on employee
  for each row execute function prevent_row_delete();

create table employment_assignment (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  location_id uuid not null references location (id),
  department text not null,
  designation text not null,
  manager_id uuid references employee (id),
  employment_type text not null check (employment_type in ('permanent', 'probation', 'contract', 'intern')),
  effective_from date not null,
  effective_to date,
  check (effective_to is null or effective_to >= effective_from),
  check (manager_id is null or manager_id <> employee_id),
  exclude using gist (
    employee_id with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  )
);

create index employment_assignment_employee_idx on employment_assignment (employee_id);

create table employee_role (
  employee_id uuid not null references employee (id),
  role text not null check (role in ('hr_admin', 'system_admin')),
  granted_at timestamptz not null default now(),
  primary key (employee_id, role)
);

create table leave_type (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  annual_quota numeric(4, 1),
  accrual_mode text not null check (accrual_mode in ('upfront', 'monthly', 'on_request')),
  statutory_floor numeric(4, 1),
  carry_forward_cap numeric(4, 1),
  encashable boolean not null default false,
  max_consecutive_days smallint,
  gender_restriction text check (gender_restriction in ('female', 'male')),
  active boolean not null default true
);

create table leave_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  leave_type_id uuid not null references leave_type (id),
  start_date date not null,
  end_date date not null,
  day_part text not null default 'full' check (day_part in ('full', 'first_half', 'second_half')),
  days numeric(4, 1) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id uuid references employee (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (approver_id is null or approver_id <> employee_id)
);

create index leave_request_status_idx on leave_request (status);
create index leave_request_dates_idx on leave_request (start_date, end_date);

create table holiday (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location (id),
  holiday_date date not null,
  name text not null,
  type text not null check (type in ('national', 'state', 'restricted')),
  verified boolean not null default false,
  unique (location_id, holiday_date)
);

create table attendance_day (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  work_date date not null,
  status text not null check (status in ('present', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off', 'wfh')),
  first_in timestamptz,
  last_out timestamptz,
  locked boolean not null default false,
  unique (employee_id, work_date)
);

create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_employee_id uuid references employee (id),
  action text not null,
  entity text not null,
  entity_id text,
  summary text
);

create function prevent_row_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function prevent_row_change();
