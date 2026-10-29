import Link from "next/link";
import { formatDate } from "@/shared/dates";
import type { LeaveOverview } from "@/modules/leave/data";
import { fmtDays } from "@/modules/leave/rules";
import { STATUS_LABELS, dateRange, partLabel, statusChipClass } from "../../_components/ui";
import { cancelLeaveAction } from "../actions";
import { LeaveTabs } from "./leave-tabs";

const SAVED: Record<string, string> = {
  applied: "Your leave request has been sent for approval.",
  cancelled: "The leave request was cancelled and the days are back in your balance.",
};

export function OverviewView(props: {
  overview: LeaveOverview;
  canApprove: boolean;
  pending: number;
  isHr: boolean;
  saved?: string;
  error?: string;
}) {
  const { overview } = props;
  const saved = props.saved ? SAVED[props.saved] : undefined;

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>My leave</h1>
          <p className="muted">Your balances and requests.</p>
        </div>
        <Link className="btn btn-primary btn-small" href="/app/leave/apply">
          Apply for leave
        </Link>
      </div>
      <LeaveTabs current="my" canApprove={props.canApprove} pending={props.pending} isHr={props.isHr} />

      {saved ? <div className="alert alert-ok" role="status">{saved}</div> : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <div className="balance-grid">
        {overview.balances.map((b) => (
          <section key={b.code} className="panel balance-card" aria-labelledby={`b-${b.code}`}>
            <h2 id={`b-${b.code}`}>{b.name}</h2>
            <p className="big">{fmtDays(b.available).replace(/ days?$/, "")}<span className="unit"> available</span></p>
            <p className="muted">
              {b.annualQuota !== null ? `${fmtDays(b.annualQuota)} a year. ` : ""}
              {b.held > 0 ? `${fmtDays(b.held)} held for pending requests.` : "Nothing is held."}
            </p>
            <Link href={`/app/leave/statement/${b.code}`} className="card-link">
              View statement
            </Link>
          </section>
        ))}
      </div>

      <section className="panel" aria-labelledby="p-requests">
        <div className="panel-head">
          <h2 id="p-requests">My requests</h2>
        </div>
        {overview.requests.length === 0 ? (
          <p className="empty">You have not applied for any leave yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th scope="col">Leave</th>
                  <th scope="col">Dates</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {overview.requests.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Leave">{r.typeName}</td>
                    <td data-label="Dates">
                      {dateRange(r.startDate, r.endDate, formatDate)}
                      {partLabel(r.dayPart)}
                    </td>
                    <td data-label="Days" className="num">
                      {fmtDays(r.days).replace(/ days?$/, "")}
                      {r.lopDays > 0 ? <span className="sub">{fmtDays(r.lopDays)} unpaid</span> : null}
                    </td>
                    <td data-label="Status">
                      <span className={statusChipClass(r.status)}>{STATUS_LABELS[r.status]}</span>
                      {r.decisionNote ? <span className="sub">{r.decisionNote}</span> : null}
                      {r.certificateRequired && r.status !== "cancelled" && r.status !== "rejected" ? (
                        <span className="sub">Give your medical certificate to HR</span>
                      ) : null}
                    </td>
                    <td data-label="">
                      {r.canCancel ? (
                        <form action={cancelLeaveAction}>
                          <input type="hidden" name="requestId" value={r.id} />
                          <button type="submit" className="btn btn-secondary btn-small">Cancel</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
