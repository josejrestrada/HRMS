-- 016: bank and salary (see docs/decisions.md, "Bank and salary (HR only)").
-- Account number, UAN and salary are encrypted by the application; the database only holds ciphertext.

create table employee_bank (
  employee_id uuid primary key references employee (id),
  account_holder text,
  bank_name text,
  ifsc text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  account_cipher text,
  account_masked text,
  uan_cipher text,
  uan_masked text,
  salary_cipher text,
  key_version smallint not null default 1,
  updated_by uuid references employee (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((account_cipher is null) = (account_masked is null)),
  check ((uan_cipher is null) = (uan_masked is null))
);

create trigger employee_bank_no_delete
  before delete on employee_bank
  for each row execute function prevent_row_delete();

create trigger employee_bank_no_truncate
  before truncate on employee_bank
  for each statement execute function prevent_truncate();

grant select, insert, update on employee_bank to hrms_app;
