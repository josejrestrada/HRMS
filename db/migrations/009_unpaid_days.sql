-- 009: how much of each frozen attendance day is unpaid (see docs/decisions.md, "Review fixes: month lock
-- races and unpaid leave in the frozen copy"). 0 = paid, 1 = a whole unpaid day, 0.5 = half a day.
alter table attendance_day
  add column unpaid_days numeric(2, 1) not null default 0 check (unpaid_days >= 0 and unpaid_days <= 1);
