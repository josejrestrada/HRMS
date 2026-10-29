-- 002: reference data that is real, not test data.

insert into location (code, name, state, weekly_off_days) values
  ('PNJ', 'Panaji', 'Goa', '{0,6}'),
  ('VRN', 'Verna', 'Goa', '{0,6}');

-- Leave types follow RESEARCH.md section 9 (R6 to R12). Statutory floors are Goa: SL 9, CL 6, EL 15.
insert into leave_type (code, name, annual_quota, accrual_mode, statutory_floor, carry_forward_cap, encashable, max_consecutive_days, gender_restriction) values
  ('CL', 'Casual leave', 8, 'upfront', 6, 0, false, 3, null),
  ('SL', 'Sick leave', 9, 'upfront', 9, 0, false, null, null),
  ('EL', 'Earned leave', 18, 'monthly', 15, 45, true, null, null),
  ('MAT', 'Maternity leave', null, 'on_request', null, null, false, null, 'female'),
  ('PAT', 'Paternity leave', 5, 'on_request', null, null, false, null, 'male'),
  ('COMPOFF', 'Comp-off', null, 'on_request', null, null, false, null, null),
  ('LOP', 'Leave without pay', null, 'on_request', null, null, false, null, null);

-- Goa 2026 public holidays from a compliance site (RESEARCH.md section 6). Dates are tentative
-- until checked against the official Goa notification, so verified = false.
insert into holiday (location_id, holiday_date, name, type, verified)
select l.id, h.d::date, h.name, h.type, false
from location l
cross join (values
  ('2026-01-26', 'Republic Day', 'national'),
  ('2026-04-14', 'Dr Ambedkar Jayanti', 'state'),
  ('2026-05-01', 'May Day', 'national'),
  ('2026-08-15', 'Independence Day', 'national'),
  ('2026-10-02', 'Gandhi Jayanti', 'national'),
  ('2026-12-03', 'Feast of St Francis Xavier', 'state'),
  ('2026-12-19', 'Goa Liberation Day', 'state'),
  ('2026-12-25', 'Christmas', 'state')
) as h(d, name, type);
