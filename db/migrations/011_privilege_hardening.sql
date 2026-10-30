-- 011: review findings 9 (see docs/decisions.md, "Review fixes: app-role privileges, impossible dates, and a
-- guard for database tests").

-- The app never changes the attendance policy, and its values feed payroll-relevant statuses. Until there
-- is an audited screen for it, the app role can read it but not change it.
revoke update on attendance_policy from hrms_app;

-- Defence in depth: the same TRUNCATE guard as the other protected tables (003, 004, 005, 008).
create trigger regularization_no_truncate
  before truncate on regularization
  for each statement execute function prevent_truncate();

create trigger compoff_request_no_truncate
  before truncate on compoff_request
  for each statement execute function prevent_truncate();

create trigger attendance_day_no_truncate
  before truncate on attendance_day
  for each statement execute function prevent_truncate();
