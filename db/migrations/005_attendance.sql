-- 005: attendance, first slice (see docs/decisions.md, "Attendance module").

-- Punches are facts: append only. `source` leaves room for biometric devices at Verna.
create table punch (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employee (id),
  punched_at timestamptz not null default now(),
  direction text not null check (direction in ('in', 'out')),
  source text not null default 'web' check (source in ('web', 'device', 'import')),
  created_at timestamptz not null default now()
);

create index punch_employee_time_idx on punch (employee_id, punched_at);

create trigger punch_append_only
  before update or delete on punch
  for each row execute function prevent_row_change();

create trigger punch_no_truncate
  before truncate on punch
  for each statement execute function prevent_truncate();

-- One policy row per location. These values are assumptions until the owner confirms them.
create table attendance_policy (
  location_id uuid primary key references location (id),
  work_start time not null default '09:30',
  grace_minutes smallint not null default 15 check (grace_minutes between 0 and 120),
  full_day_minutes smallint not null default 480 check (full_day_minutes > 0),
  half_day_minutes smallint not null default 270 check (half_day_minutes > 0),
  late_marks_per_deduction smallint not null default 3 check (late_marks_per_deduction > 0),
  regularize_until_day smallint not null default 5 check (regularize_until_day between 1 and 28),
  check (half_day_minutes < full_day_minutes)
);

insert into attendance_policy (location_id) select id from location;

-- A past day with a check-in but no check-out is a missed punch (R28). It is derived, and is only
-- stored when HR locks a month.
alter table attendance_day drop constraint attendance_day_status_check;
alter table attendance_day
  add constraint attendance_day_status_check
  check (status in ('present', 'half_day', 'absent', 'leave', 'holiday', 'weekly_off', 'wfh', 'missed_punch')),
  add column worked_minutes integer check (worked_minutes is null or worked_minutes >= 0),
  add column late boolean not null default false;

-- Minimum-privilege role (003): punches are read and append only.
grant select, insert on punch to hrms_app;
grant select, update on attendance_policy to hrms_app;
grant usage, select on all sequences in schema public to hrms_app;
