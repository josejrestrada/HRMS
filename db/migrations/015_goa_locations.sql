-- 015: work locations across all of Goa (decision 2026-10-31). Additive only.

insert into location (code, name, state, weekly_off_days) values
  ('MPS', 'Mapusa', 'Goa', '{0,6}'),
  ('PRN', 'Pernem', 'Goa', '{0,6}'),
  ('BCH', 'Bicholim', 'Goa', '{0,6}'),
  ('VLP', 'Valpoi', 'Goa', '{0,6}'),
  ('PND', 'Ponda', 'Goa', '{0,6}'),
  ('VSC', 'Vasco da Gama', 'Goa', '{0,6}'),
  ('MRG', 'Margao', 'Goa', '{0,6}'),
  ('QPM', 'Quepem', 'Goa', '{0,6}'),
  ('SNG', 'Sanguem', 'Goa', '{0,6}'),
  ('CNC', 'Canacona', 'Goa', '{0,6}'),
  ('DHB', 'Dharbandora', 'Goa', '{0,6}')
on conflict (code) do nothing;

-- Same Goa holidays as Panaji for every new location.
insert into holiday (location_id, holiday_date, name, type, verified)
select l.id, h.holiday_date, h.name, h.type, h.verified
from location l
cross join holiday h
join location p on p.id = h.location_id and p.code = 'PNJ'
where l.code in ('MPS','PRN','BCH','VLP','PND','VSC','MRG','QPM','SNG','CNC','DHB')
  and not exists (
    select 1 from holiday x where x.location_id = l.id and x.holiday_date = h.holiday_date and x.name = h.name
  );
