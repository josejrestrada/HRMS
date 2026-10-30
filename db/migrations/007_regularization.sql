-- 007: attendance regularization (see docs/decisions.md, "Attendance: regularization").

create table regularization (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  work_date date not null,
  batch_id uuid not null,
  in_time time not null,
  out_time time not null,
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id uuid references employee (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (out_time > in_time),
  check (approver_id is null or approver_id <> employee_id)
);

-- One open (pending or approved) request per person per day.
create unique index regularization_open_per_day on regularization (employee_id, work_date)
  where status in ('pending', 'approved');
create index regularization_batch_idx on regularization (batch_id);
create index regularization_pending_idx on regularization (status) where status = 'pending';

create trigger regularization_no_delete
  before delete on regularization
  for each row execute function prevent_row_delete();

-- A decided request (approved, rejected or cancelled) can never be changed.
create function protect_decided_regularization() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' then
    raise exception 'a decided regularization cannot be changed';
  end if;
  return new;
end $$;

create trigger regularization_protect_decided
  before update on regularization
  for each row execute function protect_decided_regularization();

grant select, insert, update on regularization to hrms_app;
