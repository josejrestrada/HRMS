import { formatDate, weekdayName } from "@/shared/dates";
import type { DaySheet } from "@/modules/attendance/data";
import { Avatar, displayName } from "../../_components/ui";
import { AttendanceTabs } from "./attendance-tabs";
import { STATUS_INFO, StatusChip } from "./status";

export function TeamView({ sheet, today }: { sheet: DaySheet; today: string }) {
  const order = ["present", "wfh", "half_day", "leave", "absent", "missed_punch", "weekly_off", "holiday"] as const;
  return (
    <>
      <div className="page-head">
        <h1>Attendance</h1>
        <p className="muted">
          {weekdayName(sheet.date)}, {formatDate(sheet.date)}
          {sheet.date === today ? " (today)" : ""}
        </p>
      </div>
      <AttendanceTabs current="team" isHr />

      <form method="get" action="/app/attendance/team" className="filters" aria-label="Choose a date">
        <div className="filter">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={sheet.date} max={today} />
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary btn-small">Show</button>
        </div>
      </form>

      <ul className="chips-row" aria-label="Counts">
        {order
          .filter((k) => (sheet.counts[k] ?? 0) > 0)
          .map((k) => (
            <li key={k}>
              <span className={`chip st-chip ${STATUS_INFO[k].cls}`}>
                {STATUS_INFO[k].label} {sheet.counts[k]}
              </span>
            </li>
          ))}
        {sheet.notCheckedIn > 0 ? (
          <li>
            <span className="chip">Not in yet {sheet.notCheckedIn}</span>
          </li>
        ) : null}
        {sheet.late > 0 ? (
          <li>
            <span className="chip chip-warn">Late {sheet.late}</span>
          </li>
        ) : null}
      </ul>

      <section className="panel" aria-label="Employees">
        {sheet.rows.length === 0 ? (
          <p className="empty">There are no active employees.</p>
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Location</th>
                  <th scope="col">Status</th>
                  <th scope="col">In</th>
                  <th scope="col">Out</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Employee">
                      <span className="person">
                        <Avatar name={r.fullName} />
                        <span>
                          {displayName(r.fullName)}
                          <span className="sub">{r.code}{r.department ? `, ${r.department}` : ""}</span>
                        </span>
                      </span>
                    </td>
                    <td data-label="Location">{r.location ?? "–"}</td>
                    <td data-label="Status">
                      <StatusChip status={r.day.status} provisional={r.day.provisional} />
                      {r.day.late ? <span className="sub">Late</span> : null}
                    </td>
                    <td data-label="In">{r.day.firstIn ?? "–"}</td>
                    <td data-label="Out">{r.day.lastOut ?? "–"}</td>
                    <td data-label="Note">{r.day.note ?? ""}</td>
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
