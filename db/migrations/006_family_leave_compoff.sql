-- 006: maternity, paternity and comp-off (see docs/decisions.md, "Leave: maternity, paternity and comp-off").

alter table leave_request
  add column expected_delivery_date date,
  add column surviving_children smallint check (surviving_children is null or surviving_children >= 0),
  add column birth_date date;

alter table leave_ledger drop constraint leave_ledger_reason_check;
alter table leave_ledger
  add constraint leave_ledger_reason_check
  check (reason in (
    'grant', 'accrual', 'opening_balance', 'pending_hold', 'hold_release', 'application',
    'cancellation', 'lapse', 'carry_forward', 'encashment', 'expiry', 'adjustment', 'compoff_credit'
  ));

create index leave_ledger_consumes_idx on leave_ledger (consumes_entry_id) where consumes_entry_id is not null;

create table compoff_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  worked_date date not null,
  days numeric(2, 1) not null check (days in (0.5, 1.0)),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id uuid references employee (id),
  decided_at timestamptz,
  decision_note text,
  credit_entry_id bigint references leave_ledger (id),
  created_at timestamptz not null default now(),
  check (approver_id is null or approver_id <> employee_id)
);

-- One open request per person per worked day.
create unique index compoff_open_per_day on compoff_request (employee_id, worked_date)
  where status in ('pending', 'approved');

create trigger compoff_request_no_delete
  before delete on compoff_request
  for each row execute function prevent_row_delete();

-- R53: an approved comp-off request cannot be changed or cancelled by ordinary means.
create function protect_approved_compoff() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' then
    raise exception 'approved comp-off cannot be changed';
  end if;
  return new;
end $$;

create trigger compoff_request_protect_approved
  before update on compoff_request
  for each row execute function protect_approved_compoff();

grant select, insert, update on compoff_request to hrms_app;
