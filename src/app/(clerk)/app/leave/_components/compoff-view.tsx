import Link from "next/link";
import { formatDate } from "@/shared/dates";
import type { CompoffCreditRow, CompoffRequestRow } from "@/modules/leave/data";
import { fmtDays } from "@/modules/leave/rules";
import { STATUS_LABELS, statusChipClass } from "../../_components/ui";
import { cancelCompoffAction, requestCompoffAction } from "../actions";
import { CompoffForm } from "./family-forms";

const SAVED: Record<string, string> = {
  requested: "Your comp-off request was sent for approval.",
  cancelled: "The comp-off request was cancelled.",
};

export function CompoffView(props: { credits: CompoffCreditRow[]; requests: CompoffRequestRow[]; saved?: string; error?: string }) {
  const saved = props.saved ? SAVED[props.saved] : undefined;
  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/app/leave">My leave</Link> / Comp-off
        </p>
        <h1>Comp-off</h1>
        <p className="muted">
          Worked on a weekly off or a holiday? Ask for comp-off. Once your manager approves it you can use it like leave, but each day
          expires 60 days after approval, earliest first.
        </p>
      </div>
      {saved ? <div className="alert alert-ok" role="status">{saved}</div> : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel panel-form" aria-labelledby="p-new">
        <h2 id="p-new" className="panel-title">Request comp-off</h2>
        <CompoffForm action={requestCompoffAction} />
      </section>

      <section className="panel" aria-labelledby="p-credits">
        <div className="panel-head"><h2 id="p-credits">My comp-off days</h2></div>
        {props.credits.length === 0 ? (
          <p className="empty">You have not earned any comp-off yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Earned on</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col" className="num">Left</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {props.credits.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.earnedOn)}</td>
                    <td className="num">{c.days}</td>
                    <td className="num">{c.expired ? 0 : c.remaining}</td>
                    <td>
                      {formatDate(c.expiresOn)}
                      {c.expired ? <span className="chip">Expired</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="p-reqs">
        <div className="panel-head"><h2 id="p-reqs">My requests</h2></div>
        {props.requests.length === 0 ? (
          <p className="empty">No requests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th scope="col">Day worked</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {props.requests.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Day worked">{formatDate(r.workedDate)}</td>
                    <td data-label="Days" className="num">{fmtDays(r.days).replace(/ days?$/, "")}</td>
                    <td data-label="Status">
                      <span className={statusChipClass(r.status)}>{STATUS_LABELS[r.status]}</span>
                      {r.decisionNote ? <span className="sub">{r.decisionNote}</span> : null}
                    </td>
                    <td data-label="">
                      {r.canCancel ? (
                        <form action={cancelCompoffAction}>
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
