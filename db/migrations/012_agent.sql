-- 012: HR assistant (chatbot) storage (see docs/decisions.md, "HR assistant agent (chatbot), first slice").
-- Everything here belongs to one employee and is only ever read back for that employee.

create table agent_conversation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index agent_conversation_employee_idx on agent_conversation (employee_id, created_at desc);

-- A conversation may only be archived ("Clear chat"); nothing else about it changes.
create function protect_agent_conversation() returns trigger language plpgsql as $$
begin
  if old.archived_at is not null
     or new.id <> old.id or new.employee_id <> old.employee_id or new.created_at <> old.created_at
     or new.archived_at is null then
    raise exception 'a conversation can only be archived';
  end if;
  return new;
end $$;

create trigger agent_conversation_protect
  before update on agent_conversation
  for each row execute function protect_agent_conversation();

create trigger agent_conversation_no_delete
  before delete on agent_conversation
  for each row execute function prevent_row_delete();

create trigger agent_conversation_no_truncate
  before truncate on agent_conversation
  for each statement execute function prevent_truncate();

-- Messages are append only.
create table agent_message (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references agent_conversation (id),
  employee_id uuid not null references employee (id),
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (length(content) <= 8000),
  tool_name text,
  created_at timestamptz not null default now()
);

create index agent_message_conversation_idx on agent_message (conversation_id, id);
create index agent_message_rate_idx on agent_message (employee_id, created_at) where role = 'user';

create trigger agent_message_append_only
  before update or delete on agent_message
  for each row execute function prevent_row_change();

create trigger agent_message_no_truncate
  before truncate on agent_message
  for each statement execute function prevent_truncate();

-- A draft is something the assistant prepared for the employee to confirm. It is used at most once.
create table agent_draft (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversation (id),
  employee_id uuid not null references employee (id),
  kind text not null check (kind in ('leave_application')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index agent_draft_employee_idx on agent_draft (employee_id, created_at desc);

-- The only change allowed after a draft is created: marking it used, once.
create function protect_agent_draft() returns trigger language plpgsql as $$
begin
  if old.consumed_at is not null
     or new.consumed_at is null
     or new.id <> old.id or new.employee_id <> old.employee_id or new.conversation_id <> old.conversation_id
     or new.kind <> old.kind or new.payload <> old.payload
     or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'a draft can only be marked as used, once';
  end if;
  return new;
end $$;

create trigger agent_draft_protect
  before update on agent_draft
  for each row execute function protect_agent_draft();

create trigger agent_draft_no_delete
  before delete on agent_draft
  for each row execute function prevent_row_delete();

create trigger agent_draft_no_truncate
  before truncate on agent_draft
  for each statement execute function prevent_truncate();

-- Minimum-privilege role (003).
grant select, insert, update on agent_conversation to hrms_app;
grant select, insert on agent_message to hrms_app;
grant select, insert, update on agent_draft to hrms_app;
