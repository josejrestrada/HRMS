import { formatDate } from "@/shared/dates";
import type { ApprovalRow, CompoffApprovalRow } from "@/modules/leave/data";
import { fmtDays } from "@/modules/leave/rules";
import { Avatar, dateRange, displayName, partLabel } from "../../_components/ui";
import { decideCompoffAction, decideLeaveAction } from "../actions";
import { LeaveTabs } from "./leave-tabs";

const SAVED: Record<string, string> = { approved: "Request approved.", rejected: "Request rejected." };

export function ApprovalsView(props: {
  rows: ApprovalRow[];
  compoff: CompoffApprovalRow[];
  pending: number;
  isHr: boolean;
  saved?: string;
  error?: string;
}) {
  const saved = props.saved ? SAVED[props.saved] : undefined;
  return (
    <>
      <div className="page-head">
        <h1>Approvals</h1>
        <p className="muted">
          {props.isHr ? "Leave requests from everyone, except your own." : "Leave requests from the people who report to you."}
        </p>
      </div>
      <LeaveTabs current="approvals" canApprove pending={props.pending} isHr={props.isHr} />
      {saved ? <div className="alert alert-ok" role="status">{saved}</div> : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel" aria-label="Pending requests">
        {props.rows.length === 0 && props.compoff.length === 0 ? (
          <p className="empty">Nothing is waiting for you.</p>
        ) : (
          <ul className="approval-list">
            {props.rows.map((r) => (
              <li key={r.id} className="approval">
                <div className="approval-info">
                  <span className="person">
                    <Avatar name={r.employeeName} />
                    <span>
                      {displayName(r.employeeName)}
                      <span className="sub">{r.employeeCode}</span>
                    </span>
                  </span>
                  <p>
                    <strong>{r.typeName}</strong>, {dateRange(r.startDate, r.endDate, formatDate)}
                    {partLabel(r.dayPart)}, {fmtDays(r.days)}
                    {r.lopDays > 0 ? <span className="chip chip-warn">{fmtDays(r.lopDays)} unpaid</span> : null}
                  </p>
                  {r.reason ? <p className="muted">&ldquo;{r.reason}&rdquo;</p> : null}
                  <p className="muted">
                    Waiting {r.waitingDays === 0 ? "since today" : fmtDays(r.waitingDays)}
                    {r.waitingDays >= 5 ? " (over 5 days, so HR can also decide it)" : ""}
                    {r.certificateRequired ? ". Medical certificate needed." : ""}
                  </p>
                </div>
                <form action={decideLeaveAction} className="approval-actions">
                  <input type="hidden" name="requestId" value={r.id} />
                  <label className="sr-only" htmlFor={`note-${r.id}`}>Note</label>
                  <input id={`note-${r.id}`} name="note" type="text" maxLength={300} placeholder="Reason (needed to reject)" />
                  <button type="submit" name="decision" value="approve" className="btn btn-primary btn-small">Approve</button>
                  <button type="submit" name="decision" value="reject" className="btn btn-secondary btn-small">Reject</button>
                </form>
              </li>
            ))}
            {props.compoff.map((r) => (
              <li key={r.id} className="approval">
                <div className="approval-info">
                  <span className="person">
                    <Avatar name={r.employeeName} />
                    <span>
                      {displayName(r.employeeName)}
                      <span className="sub">{r.employeeCode}</span>
                    </span>
                  </span>
                  <p>
                    <strong>Comp-off</strong> for working on {formatDate(r.workedDate)}, {fmtDays(r.days)}
                    <span className="chip">Comp-off</span>
                  </p>
                  {r.reason ? <p className="muted">&ldquo;{r.reason}&rdquo;</p> : null}
                  <p className="muted">
                    Waiting {r.waitingDays === 0 ? "since today" : fmtDays(r.waitingDays)}. Approving adds the day to their comp-off, which expires 60 days later.
                  </p>
                </div>
                <form action={decideCompoffAction} className="approval-actions">
                  <input type="hidden" name="requestId" value={r.id} />
                  <label className="sr-only" htmlFor={`cnote-${r.id}`}>Note</label>
                  <input id={`cnote-${r.id}`} name="note" type="text" maxLength={300} placeholder="Reason (needed to reject)" />
                  <button type="submit" name="decision" value="approve" className="btn btn-primary btn-small">Approve</button>
                  <button type="submit" name="decision" value="reject" className="btn btn-secondary btn-small">Reject</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
