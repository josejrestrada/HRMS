-- 004: leave ledger and request fields (decision P4; see docs/decisions.md, "Leave module").

alter table leave_request
  add column lop_days numeric(4, 1) not null default 0 check (lop_days >= 0 and lop_days <= days),
  add column certificate_required boolean not null default false,
  add column decision_note text,
  add column cancelled_at timestamptz;

create trigger leave_request_no_delete
  before delete on leave_request
  for each row execute function prevent_row_delete();

-- R21: approved leave cannot be edited. The only allowed change is cancelling it.
create function protect_approved_leave() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' then
    if new.status = 'cancelled'
       and new.employee_id = old.employee_id
       and new.leave_type_id = old.leave_type_id
       and new.start_date = old.start_date
       and new.end_date = old.end_date
       and new.day_part = old.day_part
       and new.days = old.days
       and new.lop_days = old.lop_days then
      return new;
    end if;
    raise exception 'approved leave cannot be edited; cancel it instead';
  end if;
  return new;
end $$;

create trigger leave_request_protect_approved
  before update on leave_request
  for each row execute function protect_approved_leave();

create table leave_ledger (
  id bigint generated always as identity primary key,
  employee_id uuid not null references employee (id),
  leave_type_id uuid not null references leave_type (id),
  leave_year smallint not null,
  entry_date date not null,
  delta numeric(5, 1) not null check (delta <> 0 and delta * 2 = round(delta * 2)), -- half-day steps
  reason text not null check (reason in (
    'grant', 'accrual', 'opening_balance', 'pending_hold', 'hold_release', 'application',
    'cancellation', 'lapse', 'carry_forward', 'encashment', 'expiry', 'adjustment'
  )),
  expires_on date,                                   -- credits that expire (comp-off, later)
  consumes_entry_id bigint references leave_ledger (id), -- which credit a debit used (later)
  request_id uuid references leave_request (id),
  ref_key text,                                      -- idempotency key for credit jobs
  note text,
  created_at timestamptz not null default now()
);

create index leave_ledger_balance_idx on leave_ledger (employee_id, leave_type_id);
create unique index leave_ledger_ref_key_idx on leave_ledger (ref_key) where ref_key is not null;

create trigger leave_ledger_append_only
  before update or delete on leave_ledger
  for each row execute function prevent_row_change();

create trigger leave_ledger_no_truncate
  before truncate on leave_ledger
  for each statement execute function prevent_truncate();

-- Minimum-privilege role (003): read and append only.
grant select, insert on leave_ledger to hrms_app;
