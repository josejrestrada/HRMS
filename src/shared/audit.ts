import "server-only";
import { query } from "./db";

export async function recordAudit(entry: {
  actorEmployeeId: string | null;
  action: string;
  entity: string;
  entityId?: string;
  summary?: string;
}): Promise<void> {
  await query(
    "insert into audit_log (actor_employee_id, action, entity, entity_id, summary) values ($1, $2, $3, $4, $5)",
    [entry.actorEmployeeId, entry.action, entry.entity, entry.entityId ?? null, entry.summary ?? null],
  );
}
