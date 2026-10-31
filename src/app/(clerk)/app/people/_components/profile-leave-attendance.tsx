import Link from "next/link";
import { formatDate, weekdayName } from "@/shared/dates";
import type { EmployeeLeaveView } from "@/modules/leave/data";
import type { EmployeeMonth } from "@/modules/attendance/data";
import { fmtDays } from "@/modules/leave/rules";
import { formatMinutes } from "@/modules/attendance/rules";
import { STATUS_LABELS, dateRange, partLabel, statusChipClass } from "../../_components/ui";
import { hrFixDayAction, hrReviewFixAction } from "../attendance-actions";
import { STATUS_INFO, StatusChip } from "../../attendance/_components/status";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ProfileLeave({ data }: { data: EmployeeLeaveView }) {
  return (
    <>
      <div className="balance-grid">
        {data.balances.map((b) => (
          <section key={b.code} className="panel balance-card" aria-labelledby={`b-${b.code}`}>
            <h2 id={`b-${b.code}`}>{b.name}</h2>
            <p className="big">
              {fmtDays(b.available).replace(/ days?$/, "")}
              <span className="unit"> available</span>
            </p>
            <p className="muted">
              {b.annualQuota !== null ? `${fmtDays(b.annualQuota)} a year. ` : ""}
              {b.held > 0 ? `${fmtDays(b.held)} held for pending requests.` : "Nothing is held."}
            </p>
          </section>
        ))}
      </div>
      <section className="panel" aria-labelledby="p-leave-requests">
        <div className="panel-head">
          <h2 id="p-leave-requests">Requests</h2>
          <Link href="/app/leave/approvals">Approvals</Link>
        </div>
        {data.requests.length === 0 ? (
          <p className="empty">No leave requests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th scope="col">Leave</th>
                  <th scope="col">Dates</th>
                  <th scope="col" className="num">Days</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
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

function DayActions(props: {
  day: string;
  extras: EmployeeMonth["extras"][string] | undefined;
  defaults: { in: string; out: string };
  employeeId: string;
  monthKey: string;
}) {
  const { day, extras, defaults, employeeId, monthKey } = props;
  if (!extras) return <span className="muted">–</span>;
  const hidden = (
    <>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="m" value={monthKey} />
    </>
  );
  const none = extras.punches.length === 0 && !extras.pending && !extras.canFix;
  if (none) return <span className="muted">–</span>;
  return (
    <div className="day-actions">
      {extras.punches.length > 0 ? (
        <details>
          <summary>View punches</summary>
          <ul className="plain-links">
            {extras.punches.map((p, i) => (
              <li key={i}>
                {p.direction === "in" ? "Check in" : "Check out"} <span className="mono">{p.time}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {extras.pending ? (
        <details>
          <summary>Review fix</summary>
          <p className="sub">
            {extras.pending.inTime} to {extras.pending.outTime}: {extras.pending.reason}
          </p>
          <form action={hrReviewFixAction} className="inline-form">
            {hidden}
            <input type="hidden" name="requestId" value={extras.pending.id} />
            <button type="submit" name="decision" value="approve" className="btn btn-primary btn-small">
              Approve
            </button>{" "}
            <button type="submit" name="decision" value="reject" className="btn btn-secondary btn-small">
              Reject
            </button>
          </form>
        </details>
      ) : null}
      {extras.canFix ? (
        <details>
          <summary>Fix day</summary>
          <form action={hrFixDayAction} className="form">
            {hidden}
            <input type="hidden" name="date" value={day} />
            <div className="fix-times">
              <label>
                <span className="sr-only">Check-in time</span>
                <input type="time" name="in" defaultValue={defaults.in} required />
              </label>
              <span aria-hidden="true">to</span>
              <label>
                <span className="sr-only">Check-out time</span>
                <input type="time" name="out" defaultValue={defaults.out} required />
              </label>
            </div>
            <div className="field">
              <label htmlFor={`reason-${day}`}>Reason (required)</label>
              <input id={`reason-${day}`} name="reason" required minLength={3} maxLength={300} autoComplete="off" />
            </div>
            <button type="submit" className="btn btn-primary btn-small">
              Fix day
            </button>
            <p className="hint">Takes effect at once and is recorded as done by you.</p>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function ProfileAttendance({ data, base, employeeId }: { data: EmployeeMonth; base: string; employeeId: string }) {
  const monthKey = `${data.year}-${String(data.month).padStart(2, "0")}`;
  const prev = data.month === 1 ? { y: data.year - 1, m: 12 } : { y: data.year, m: data.month - 1 };
  const next = data.month === 12 ? { y: data.year + 1, m: 1 } : { y: data.year, m: data.month + 1 };
  const link = (y: number, m: number) => `${base}?tab=attendance&m=${y}-${String(m).padStart(2, "0")}`;
  const counts = data.summary.counts;
  const totals: [string, number][] = [
    ["Present", counts.present],
    ["Work from home", counts.wfh],
    ["Half days", counts.half_day],
    ["On leave", counts.leave],
    ["Absent", counts.absent + counts.missed_punch],
    ["Late marks", data.summary.lateMarks],
  ];
  return (
    <section className="panel" aria-labelledby="p-attendance">
      <div className="panel-head">
        <h2 id="p-attendance">
          {MONTH_NAMES[data.month - 1]} {data.year}
        </h2>
        <span>
          <Link href={link(prev.y, prev.m)}>Previous</Link> · <Link href={link(next.y, next.m)}>Next</Link>
        </span>
      </div>
      {data.locked ? <p className="muted">This month is locked. The figures are the frozen copy.</p> : null}
      <p className="chips">
        {totals.map(([label, n]) => (
          <span key={label} className="chip">
            {label}: {n}
          </span>
        ))}
      </p>
      <div className="table-wrap">
        <table className="people-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">Worked</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.days
              .filter((d) => d.employed)
              .map((d) => (
                <tr key={d.date}>
                  <td data-label="Date">
                    {formatDate(d.date)}
                    <span className="sub">{weekdayName(d.date)}</span>
                  </td>
                  <td data-label="In">{d.firstIn ?? "–"}</td>
                  <td data-label="Out">{d.lastOut ?? "–"}</td>
                  <td data-label="Worked">{d.workedMinutes ? formatMinutes(d.workedMinutes) : "–"}</td>
                  <td data-label="Status">
                    <StatusChip status={d.status} provisional={d.provisional} />
                    {d.late ? <span className="sub">Late</span> : null}
                    {d.note && STATUS_INFO[d.status] ? <span className="sub">{d.note}</span> : null}
                  </td>
                  <td data-label="Actions">
                    <DayActions day={d.date} extras={data.extras[d.date]} defaults={data.defaults} employeeId={employeeId} monthKey={monthKey} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
