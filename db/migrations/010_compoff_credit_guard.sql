-- 010: a comp-off credit can never be overspent (see docs/decisions.md, "Review fixes: comp-off concurrency,
-- one maternity per delivery, manager effective today").
--
-- Any ledger row that uses a comp-off credit (consumes_entry_id set: leave taken, a cancellation giving
-- days back, or an expiry) must leave that credit with between 0 and its original number of days. A
-- per-credit advisory lock makes two such rows for the same credit run one after the other, and it needs
-- no extra privilege, so the application role can use it.

create function guard_compoff_credit() returns trigger language plpgsql as $$
declare
  credit_delta numeric;
  used numeric;
  left_after numeric;
begin
  if new.consumes_entry_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(7102, hashtext(new.consumes_entry_id::text));

  select delta into credit_delta
    from leave_ledger
   where id = new.consumes_entry_id and reason = 'compoff_credit';
  if credit_delta is null then
    raise exception 'consumes_entry_id must point to a comp-off credit';
  end if;

  select coalesce(sum(delta), 0) into used from leave_ledger where consumes_entry_id = new.consumes_entry_id;
  left_after := credit_delta + used + new.delta;

  if left_after < 0 then
    raise exception 'comp-off credit would go below zero';
  end if;
  if left_after > credit_delta then
    raise exception 'comp-off credit would exceed its original amount';
  end if;
  return new;
end $$;

create trigger leave_ledger_guard_compoff_credit
  before insert on leave_ledger
  for each row execute function guard_compoff_credit();
