-- 008: attendance month lock (see docs/decisions.md, "Attendance: month lock").

alter table attendance_day add column note text;

-- One row per locked month. Append only: a lock is never undone in the app.
create table attendance_period (
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  locked_at timestamptz not null default now(),
  locked_by uuid not null references employee (id),
  employee_count integer not null check (employee_count >= 0),
  primary key (year, month)
);

create trigger attendance_period_append_only
  before update or delete on attendance_period
  for each row execute function prevent_row_change();

create trigger attendance_period_no_truncate
  before truncate on attendance_period
  for each statement execute function prevent_truncate();

-- Frozen days cannot be edited or deleted (R60).
create function protect_locked_attendance_day() returns trigger language plpgsql as $$
begin
  if old.locked then
    raise exception 'a locked attendance day cannot be changed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger attendance_day_protect_locked
  before update or delete on attendance_day
  for each row execute function protect_locked_attendance_day();

create function is_month_locked(d date) returns boolean language sql stable as $$
  select exists (
    select 1 from attendance_period
     where year = extract(year from d)::int and month = extract(month from d)::int
  )
$$;

-- No punch can be added for a locked month (R60).
create function reject_punch_in_locked_month() returns trigger language plpgsql as $$
begin
  if is_month_locked((new.punched_at at time zone 'Asia/Kolkata')::date) then
    raise exception 'that month is locked';
  end if;
  return new;
end $$;

create trigger punch_locked_month
  before insert on punch
  for each row execute function reject_punch_in_locked_month();

-- No fix can be sent or approved for a locked month (R60).
create function reject_regularization_in_locked_month() returns trigger language plpgsql as $$
begin
  if is_month_locked(new.work_date) then
    raise exception 'that month is locked';
  end if;
  return new;
end $$;

create trigger regularization_locked_month
  before insert or update on regularization
  for each row execute function reject_regularization_in_locked_month();

grant select, insert on attendance_period to hrms_app;
