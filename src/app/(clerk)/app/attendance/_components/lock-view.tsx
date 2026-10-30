import Link from "next/link";
import { formatDate } from "@/shared/dates";
import type { LockPreview, MonthLockRow } from "@/modules/attendance/data";
import { MONTH_NAMES } from "@/modules/attendance/rules";
import { plural } from "../../_components/ui";
import { lockMonthAction } from "../actions";
import { AttendanceTabs } from "./attendance-tabs";

export function LockView(props: {
  year: number;
  months: MonthLockRow[];
  preview?: LockPreview;
  canApprove: boolean;
  pendingApprovals: number;
  saved?: { month: string; people: string; unpaid: string };
  error?: string;
}) {
  return (
    <>
      <div className="page-head">
        <h1>Month lock</h1>
        <p className="muted">
          Closing a month saves a final copy of everyone&apos;s attendance for payroll. Days that were not fixed in time become unpaid. This cannot be undone.
        </p>
      </div>
      <AttendanceTabs current="lock" isHr canApprove={props.canApprove} pending={props.pendingApprovals} />

      {props.saved ? (
        <div className="alert alert-ok" role="status">
          {MONTH_NAMES[Number(props.saved.month) - 1]} {props.year} is locked for {plural(Number(props.saved.people), "person", "people")}.{" "}
          {Number(props.saved.unpaid) > 0 ? `${plural(Number(props.saved.unpaid), "day", "days")} counted as unpaid.` : "No days were counted as unpaid."}
        </div>
      ) : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <div className="month-nav">
        <Link className="btn btn-secondary btn-small" href={`/app/attendance/lock?year=${props.year - 1}`}>
          {props.year - 1}
        </Link>
        <h2>{props.year}</h2>
        <Link className="btn btn-secondary btn-small" href={`/app/attendance/lock?year=${props.year + 1}`}>
          {props.year + 1}
        </Link>
      </div>

      <section className="panel" aria-label="Months">
        <div className="table-wrap">
          <table className="people-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Status</th>
                <th scope="col">Locked</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {props.months.map((m) => (
                <tr key={m.month}>
                  <td data-label="Month">{MONTH_NAMES[m.month - 1]}</td>
                  <td data-label="Status">
                    <span className={m.state === "locked" ? "chip chip-ok" : m.state === "open" ? "chip chip-warn" : "chip"}>
                      {m.state === "locked" ? "Locked" : m.state === "open" ? "Open" : "Not finished"}
                    </span>
                  </td>
                  <td data-label="Locked">
                    {m.state === "locked" ? (
                      <>
                        {m.lockedAt ? formatDate(m.lockedAt.slice(0, 10)) : ""} by {m.lockedBy}
                        <span className="sub">{plural(m.employees ?? 0, "person", "people")}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td data-label="">
                    {m.state === "open" ? (
                      <Link className="btn btn-secondary btn-small" href={`/app/attendance/lock?year=${props.year}&month=${m.month}`}>
                        Review and lock
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {props.preview ? (
        <section className="panel panel-form" aria-labelledby="p-preview">
          <h2 id="p-preview" className="panel-title">Lock {props.preview.label}</h2>
          <p className="muted">
            {plural(props.preview.employees, "person", "people")} worked here this month. {plural(props.preview.days, "day", "days")} will be saved.
          </p>
          <p>
            <strong>{plural(props.preview.unpaidDays, "day", "days")}</strong> will count as unpaid because they were not fixed.
          </p>
          {props.preview.unpaidPeople.length > 0 ? (
            <ul className="rows">
              {props.preview.unpaidPeople.map((p) => (
                <li key={p.code}>
                  <span>
                    {p.name.replace(/^TEST\s+/, "")}
                    <span className="sub">{p.code}</span>
                  </span>
                  <strong>{plural(p.days, "day", "days")}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          {props.preview.beforeDeadline && props.preview.blockers.length === 0 ? (
            <p className="alert alert-error" role="status">
              Employees can still send fixes for this month. Locking now stops that and those days become unpaid.
            </p>
          ) : null}
          {props.preview.blockers.map((b) => (
            <p key={b} className="alert alert-error" role="alert">{b}</p>
          ))}
          <form action={lockMonthAction} className="form">
            <input type="hidden" name="year" value={props.preview.year} />
            <input type="hidden" name="month" value={props.preview.month} />
            <div className="form-actions">
              <button type="submit" className="btn btn-danger btn-small" disabled={!props.preview.canLock}>
                Lock {props.preview.label}
              </button>
            </div>
            <p className="hint">This saves a final copy and cannot be undone in the app. Mistakes after locking are corrected with an adjustment.</p>
          </form>
        </section>
      ) : null}
    </>
  );
}
