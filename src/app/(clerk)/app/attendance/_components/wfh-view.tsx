import type { MyWfh } from "@/modules/attendance/data";
import { formatDate, weekdayName } from "@/shared/dates";
import { plural } from "../../_components/ui";
import { cancelWfhAction, requestWfhAction } from "../actions";
import { AttendanceTabs } from "./attendance-tabs";
import { WfhForm } from "./wfh-form";

const STATUS_LABEL = { pending: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" } as const;
const STATUS_CLASS = { pending: "chip chip-warn", approved: "chip chip-ok", rejected: "chip", cancelled: "chip" } as const;

export function WfhView(props: {
  data: MyWfh;
  isHr: boolean;
  canApprove: boolean;
  pending: number;
  saved?: string;
  count?: string;
  skipped?: string;
  error?: string;
  action?: typeof requestWfhAction;
}) {
  const { data } = props;
  const left = Math.max(0, data.daysPerMonth - data.usedThisMonth);
  return (
    <>
      <div className="page-head">
        <h1>Work from home</h1>
        <p className="muted">An approved day counts as a normal working day. No leave is taken.</p>
      </div>
      <AttendanceTabs current="wfh" isHr={props.isHr} canApprove={props.canApprove} pending={props.pending} />
      {props.saved === "requested" ? (
        <div className="alert alert-ok" role="status">
          Sent {plural(Number(props.count ?? "1"), "day", "days")} to your manager.
          {Number(props.skipped ?? "0") > 0 ? ` ${plural(Number(props.skipped), "day was", "days were")} skipped (weekly off, holiday, leave or already requested).` : ""}
        </div>
      ) : null}
      {props.saved === "cancelled" ? <div className="alert alert-ok" role="status">Request cancelled.</div> : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel panel-form" aria-label="Ask to work from home">
        {data.allowed ? (
          <>
            <p className="muted">
              You can work from home {plural(data.daysPerMonth, "day", "days")} a month. This month you have used {data.usedThisMonth} and have {left} left.
            </p>
            <WfhForm action={props.action ?? requestWfhAction} today={data.today} latest={data.latestDate} />
          </>
        ) : (
          <p className="empty">Work from home is not available for your location. If you think this is wrong, please talk to your manager or HR.</p>
        )}
      </section>

      <section className="panel" aria-label="My work-from-home requests">
        <div className="panel-head">
          <h2>My requests</h2>
        </div>
        {data.requests.length === 0 ? (
          <p className="empty">You have not asked to work from home yet.</p>
        ) : (
          <ul className="rows">
            {data.requests.map((r) => (
              <li key={r.id}>
                <span>
                  {weekdayName(r.date).slice(0, 3)} {formatDate(r.date)}
                  <span className="sub">
                    {r.reason}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                  </span>
                </span>
                <span className="inline-form">
                  <span className={STATUS_CLASS[r.status]}>{STATUS_LABEL[r.status]}</span>
                  {r.canCancel ? (
                    <form action={cancelWfhAction}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit" className="btn btn-secondary btn-small">Cancel</button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
