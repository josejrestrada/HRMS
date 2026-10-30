import { formatDate, weekdayName } from "@/shared/dates";
import type { RegularizationApproval } from "@/modules/attendance/data";
import { Avatar, displayName, plural } from "../../_components/ui";
import { decideRegularizationAction } from "../actions";
import { AttendanceTabs } from "./attendance-tabs";

const SAVED: Record<string, string> = { approved: "approved", rejected: "rejected" };

type Group = { key: string; employeeName: string; employeeCode: string; reason: string; waitingDays: number; rows: RegularizationApproval[] };

function group(rows: RegularizationApproval[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const g = map.get(r.batchId) ?? { key: r.batchId, employeeName: r.employeeName, employeeCode: r.employeeCode, reason: r.reason, waitingDays: r.waitingDays, rows: [] };
    g.rows.push(r);
    map.set(r.batchId, g);
  }
  return [...map.values()];
}

export function AttendanceApprovalsView(props: {
  rows: RegularizationApproval[];
  isHr: boolean;
  saved?: string;
  count?: string;
  error?: string;
}) {
  const groups = group(props.rows);
  return (
    <>
      <div className="page-head">
        <h1>Attendance approvals</h1>
        <p className="muted">
          {props.isHr ? "Fixes from everyone, except your own." : "Fixes from the people who report to you."} Approving replaces the day&apos;s times; the original
          check-ins are always kept.
        </p>
      </div>
      <AttendanceTabs current="approvals" isHr={props.isHr} canApprove pending={props.rows.length} />
      {props.saved && SAVED[props.saved] ? (
        <div className="alert alert-ok" role="status">
          {plural(Number(props.count ?? "1"), "fix", "fixes")} {SAVED[props.saved]}.
        </div>
      ) : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel" aria-label="Pending fixes">
        {groups.length === 0 ? (
          <p className="empty">Nothing is waiting for you.</p>
        ) : (
          <ul className="approval-list">
            {groups.map((g) => (
              <li key={g.key} className="approval approval-stack">
                <div className="approval-info">
                  <span className="person">
                    <Avatar name={g.employeeName} />
                    <span>
                      {displayName(g.employeeName)}
                      <span className="sub">{g.employeeCode}</span>
                    </span>
                  </span>
                  <p className="muted">&ldquo;{g.reason}&rdquo; &middot; waiting {g.waitingDays === 0 ? "since today" : plural(g.waitingDays, "day", "days")}</p>
                  <ul className="rows">
                    {g.rows.map((r) => (
                      <li key={r.id}>
                        <span>
                          {weekdayName(r.date).slice(0, 3)} {formatDate(r.date)}
                          <span className="sub">
                            {r.inTime} to {r.outTime}
                          </span>
                        </span>
                        <form action={decideRegularizationAction} className="inline-form">
                          <input type="hidden" name="requestId" value={r.id} />
                          <button type="submit" name="decision" value="approve" className="btn btn-primary btn-small">Approve</button>
                          <button type="submit" name="decision" value="reject" className="btn btn-secondary btn-small">Reject</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
                {g.rows.length > 1 ? (
                  <form action={decideRegularizationAction} className="approval-actions">
                    {g.rows.map((r) => (
                      <input key={r.id} type="hidden" name="requestId" value={r.id} />
                    ))}
                    <label className="sr-only" htmlFor={`note-${g.key}`}>Note</label>
                    <input id={`note-${g.key}`} name="note" type="text" maxLength={300} placeholder="Reason (needed to reject)" />
                    <button type="submit" name="decision" value="approve" className="btn btn-primary btn-small">Approve all {g.rows.length}</button>
                    <button type="submit" name="decision" value="reject" className="btn btn-secondary btn-small">Reject all</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
