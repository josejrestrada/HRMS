import type { HrDashboard } from "@/modules/reports/data";
import { daysBetween, formatDate, weekdayName } from "@/shared/dates";

const ATTENDANCE_LABELS: [string, string][] = [
  ["present", "Present"],
  ["wfh", "Work from home"],
  ["half_day", "Half day"],
  ["leave", "On leave"],
  ["absent", "Absent"],
];

const TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  probation: "Probation",
  contract: "Contract",
  intern: "Intern",
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function HrDashboardView({ data }: { data: HrDashboard }) {
  const { headcount, onLeave, pending, attendance, holidays, recentJoiners, attention } = data;
  const nothingToFlag = attention.withoutManager === 0 && attention.notSignedIn === 0 && pending.count === 0;

  return (
    <>
      <div className="page-head">
        <h1>HR dashboard</h1>
        <p className="muted">
          {weekdayName(data.today)}, {formatDate(data.today)} (IST)
        </p>
      </div>

      <div className="dash-grid">
        <section className="panel" aria-labelledby="p-headcount">
          <h2 id="p-headcount">Active employees</h2>
          <p className="big">{headcount.total}</p>
          {headcount.byLocation.length > 0 ? (
            <ul className="inline-list">
              {headcount.byLocation.map((l) => (
                <li key={l.name}>
                  {l.name} <strong>{l.count}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No active employees yet.</p>
          )}
          {headcount.byType.length > 0 ? (
            <ul className="inline-list muted">
              {headcount.byType.map((t) => (
                <li key={t.type}>
                  {TYPE_LABELS[t.type] ?? t.type} {t.count}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="p-leave">
          <h2 id="p-leave">On leave today</h2>
          <p className="big">{onLeave.length}</p>
          {onLeave.length === 0 ? (
            <p className="muted">Nobody is on approved leave today.</p>
          ) : (
            <ul className="plain-list">
              {onLeave.slice(0, 6).map((p) => (
                <li key={p.employeeCode}>
                  <span>{p.fullName}</span>
                  <span className="muted">
                    {p.leaveCode}, until {formatDate(p.endDate)}
                  </span>
                </li>
              ))}
              {onLeave.length > 6 ? <li className="muted">and {onLeave.length - 6} more</li> : null}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="p-pending">
          <h2 id="p-pending">Pending leave requests</h2>
          <p className="big">{pending.count}</p>
          {pending.count === 0 ? (
            <p className="muted">No requests are waiting.</p>
          ) : (
            <p className="muted">
              Oldest has been waiting {plural(pending.oldestAgeDays ?? 0, "day", "days")}.
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="p-attendance">
          <h2 id="p-attendance">Attendance today</h2>
          {attendance.recorded === 0 ? (
            <p className="muted">No attendance has been recorded for today yet.</p>
          ) : (
            <ul className="plain-list">
              {ATTENDANCE_LABELS.map(([key, label]) => (
                <li key={key}>
                  <span>{label}</span>
                  <strong>{attendance.counts[key] ?? 0}</strong>
                </li>
              ))}
            </ul>
          )}
          {attendance.recorded > 0 && attendance.notRecorded > 0 ? (
            <p className="muted">{attendance.notRecorded} not recorded yet.</p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="p-holidays">
          <h2 id="p-holidays">Upcoming holidays</h2>
          {holidays.length === 0 ? (
            <p className="muted">No upcoming holidays are set up.</p>
          ) : (
            <ul className="plain-list">
              {holidays.map((h) => (
                <li key={`${h.date}-${h.name}`}>
                  <span>
                    <strong>{formatDate(h.date)}</strong> {h.name}
                    {!h.verified ? <span className="chip chip-warn">Tentative</span> : null}
                  </span>
                  <span className="muted">
                    {daysBetween(data.today, h.date) === 0
                      ? "Today"
                      : `in ${plural(daysBetween(data.today, h.date), "day", "days")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="p-attention">
          <h2 id="p-attention">Needs attention</h2>
          {nothingToFlag ? (
            <p className="muted">Nothing needs attention.</p>
          ) : (
            <ul className="plain-list">
              {pending.count > 0 ? (
                <li>
                  <span>Leave requests waiting for a decision</span>
                  <strong>{pending.count}</strong>
                </li>
              ) : null}
              {attention.withoutManager > 0 ? (
                <li>
                  <span>Employees with no reporting manager</span>
                  <strong>{attention.withoutManager}</strong>
                </li>
              ) : null}
              {attention.notSignedIn > 0 ? (
                <li>
                  <span>Employees not yet signed in</span>
                  <strong>{attention.notSignedIn}</strong>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        <section className="panel panel-wide" aria-labelledby="p-joiners">
          <h2 id="p-joiners">Recent joiners (last 30 days)</h2>
          {recentJoiners.length === 0 ? (
            <p className="muted">Nobody has joined in the last 30 days.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Role</th>
                    <th scope="col">Location</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJoiners.map((p) => (
                    <tr key={p.employeeCode}>
                      <td>{p.employeeCode}</td>
                      <td>{p.fullName}</td>
                      <td>{p.designation}</td>
                      <td>{p.location}</td>
                      <td>{formatDate(p.joiningDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
