-- 013: work-from-home requests (see docs/decisions.md, "Work-from-home requests").

-- Per-location policy. Assumptions until the owner confirms them.
alter table attendance_policy
  add column wfh_allowed boolean not null default false,
  add column wfh_days_per_month smallint not null default 4 check (wfh_days_per_month between 0 and 31);

update attendance_policy set wfh_allowed = true where location_id = (select id from location where code = 'PNJ');

create table wfh_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  work_date date not null,
  batch_id uuid not null,
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id uuid references employee (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (approver_id is null or approver_id <> employee_id)
);

-- One open (pending or approved) request per person per day.
create unique index wfh_request_open_per_day on wfh_request (employee_id, work_date)
  where status in ('pending', 'approved');
create index wfh_request_batch_idx on wfh_request (batch_id);
create index wfh_request_pending_idx on wfh_request (status) where status = 'pending';

create trigger wfh_request_no_delete
  before delete on wfh_request
  for each row execute function prevent_row_delete();

create trigger wfh_request_no_truncate
  before truncate on wfh_request
  for each statement execute function prevent_truncate();

-- A pending request can be decided or cancelled. An approved one can only be cancelled (by the person, for a
-- future day: checked in the app). Rejected and cancelled requests never change.
create function protect_decided_wfh() returns trigger language plpgsql as $$
begin
  if old.status = 'pending' then
    return new;
  end if;
  if old.status = 'approved' and new.status = 'cancelled'
     and new.employee_id = old.employee_id and new.work_date = old.work_date and new.reason = old.reason then
    return new;
  end if;
  raise exception 'a decided work-from-home request cannot be changed';
end $$;

create trigger wfh_request_protect_decided
  before update on wfh_request
  for each row execute function protect_decided_wfh();

grant select, insert, update on wfh_request to hrms_app;
