-- 014: PAN and Aadhaar last four digits (see docs/decisions.md, "PAN and Aadhaar (personal details)").
-- The full Aadhaar number is never stored (P7). PAN is encrypted by the application; the database only holds ciphertext.

create table employee_private (
  employee_id uuid primary key references employee (id),
  pan_cipher text,
  pan_hash text unique,
  pan_masked text,
  key_version smallint not null default 1,
  aadhaar_last4 text check (aadhaar_last4 ~ '^[0-9]{4}$'),
  aadhaar_verified boolean not null default false,
  updated_by uuid references employee (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((pan_cipher is null) = (pan_hash is null) and (pan_cipher is null) = (pan_masked is null))
);

create trigger employee_private_no_delete
  before delete on employee_private
  for each row execute function prevent_row_delete();

create trigger employee_private_no_truncate
  before truncate on employee_private
  for each statement execute function prevent_truncate();

grant select, insert, update on employee_private to hrms_app;
