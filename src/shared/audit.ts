import "server-only";
import { query, type Queryable } from "./db";

/** Appends an audit entry. Pass `runner` to write it inside an existing transaction. */
export async function recordAudit(
  entry: {
    actorEmployeeId: string | null;
    action: string;
    entity: string;
    entityId?: string;
    summary?: string;
  },
  runner: Queryable = { query },
): Promise<void> {
  await runner.query(
    "insert into audit_log (actor_employee_id, action, entity, entity_id, summary) values ($1, $2, $3, $4, $5)",
    [entry.actorEmployeeId, entry.action, entry.entity, entry.entityId ?? null, entry.summary ?? null],
  );
}
