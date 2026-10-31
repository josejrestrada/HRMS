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
                <input type="text" name="in" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="09:30" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" defaultValue={defaults.in} required />
              </label>
              <span aria-hidden="true">to</span>
              <label>
                <span className="sr-only">Check-out time</span>
                <input type="text" name="out" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="18:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" defaultValue={defaults.out} required />
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
  const s = data.summary;
  const stats: [string, number][] = [
    ["Present", s.counts.present],
    ["Half days", s.counts.half_day],
    ["On leave", s.counts.leave],
    ["Work from home", s.counts.wfh],
    ["Absent", s.counts.absent + s.counts.missed_punch],
  ];
  const firstWeekday = data.days.length > 0 ? (new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const needsFix = data.days.filter((d) => data.extras[d.date]?.canFix || data.extras[d.date]?.pending).length;
  const legend = ["present", "half_day", "wfh", "leave", "absent", "holiday", "weekly_off"] as const;

  return (
    <>
      <div className="month-nav">
        <Link className="btn btn-secondary btn-small" href={link(prev.y, prev.m)} aria-label="Previous month">
          Previous
        </Link>
        <h2>
          {MONTH_NAMES[data.month - 1]} {data.year}
        </h2>
        <Link className="btn btn-secondary btn-small" href={link(next.y, next.m)} aria-label="Next month">
          Next
        </Link>
      </div>
      {data.locked ? (
        <div className="alert alert-ok" role="status">
          This month is locked. The figures are final and its days can no longer be changed.
        </div>
      ) : null}

      <div className="att-summary">
        {stats.map(([label, n]) => (
          <div key={label} className="att-stat">
            <p className="att-stat-value">{n}</p>
            <p className="muted">{label}</p>
          </div>
        ))}
        <div className="att-stat">
          <p className="att-stat-value">
            {s.lateMarks} <span className="unit">of {s.lateLimit}</span>
          </p>
          <p className="muted">Late marks</p>
        </div>
      </div>

      <section className="panel" aria-label="Calendar">
        <div className="cal" role="grid" aria-label={`${MONTH_NAMES[data.month - 1]} ${data.year}`}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="cal-head" role="columnheader">
              {d}
            </div>
          ))}
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`b${i}`} className="cal-blank" />
          ))}
          {data.days.map((d) => {
            const info = STATUS_INFO[d.status];
            const x = data.extras[d.date];
            const inner = (
              <>
                <span className="cal-date">{Number(d.date.slice(8))}</span>
                {d.employed && d.status !== "upcoming" ? (
                  <span className="cal-status">{d.provisional && d.status === "absent" ? "Not in yet" : info.short}</span>
                ) : null}
                {d.firstIn ? (
                  <span className="cal-times">
                    {d.firstIn}
                    {d.lastOut ? `–${d.lastOut}` : ""}
                  </span>
                ) : null}
                {d.late ? <span className="cal-late">Late</span> : null}
                {x?.pending ? <span className="cal-late">Fix to review</span> : x?.canFix ? <span className="cal-late">Needs fix</span> : null}
              </>
            );
            const cls = `cal-cell ${d.employed ? info.cls : "st-upcoming"}${d.date === data.today ? " cal-today" : ""}`;
            return d.employed ? (
              <a key={d.date} href={`#day-${d.date}`} role="gridcell" className={`${cls} cal-link`} aria-label={`${formatDate(d.date)}: ${info.label}`}>
                {inner}
              </a>
            ) : (
              <div key={d.date} role="gridcell" className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
        <ul className="legend cal-legend" aria-label="Colours">
          {legend.map((k) => (
            <li key={k}>
              <span className={`cal-key ${STATUS_INFO[k].cls}`} aria-hidden="true" />
              <span>{STATUS_INFO[k].label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="p-days">
        <div className="panel-head">
          <h2 id="p-days">Day by day</h2>
          {needsFix > 0 ? <span className="chip chip-warn">{needsFix} to act on</span> : <span className="muted">Nothing to act on</span>}
        </div>
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
                  <tr key={d.date} id={`day-${d.date}`} className="day-row">
                    <td data-label="Date">
                      {formatDate(d.date)}
                      <span className="sub">{weekdayName(d.date)}</span>
                    </td>
                    <td data-label="In">{d.firstIn ?? "–"}</td>
                    <td data-label="Out">{d.lastOut ?? "–"}</td>
                    <td data-label="Worked">
                      {d.workedMinutes ? (
                        <>
                          {formatMinutes(d.workedMinutes)}
                          <span className="hours-bar" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, Math.round((d.workedMinutes / 480) * 100))}%` }} />
                          </span>
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
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
    </>
  );
}
