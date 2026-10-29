import type { ReactNode } from "react";
import type { HrDashboard } from "@/modules/reports/data";
import { daysBetween, formatDate, weekdayName } from "@/shared/dates";

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const icons = {
  people: (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c2 .7 3.5 2.6 3.5 5.6" />
    </svg>
  ),
  check: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16.5 9.5" />
    </svg>
  ),
  leave: (
    <svg {...iconProps}>
      <path d="M4 20c0-9 6-15 16-16 0 10-6 16-16 16Z" />
      <path d="M4 20c3-5 6.5-8.5 11-11" />
    </svg>
  ),
  clock: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  alert: (
    <svg {...iconProps}>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </svg>
  ),
};

const ATTENDANCE: { key: string; label: string; color: string }[] = [
  { key: "present", label: "Present", color: "var(--series-1)" },
  { key: "wfh", label: "Work from home", color: "var(--series-2)" },
  { key: "half_day", label: "Half day", color: "var(--series-3)" },
  { key: "leave", label: "On leave", color: "var(--series-4)" },
  { key: "absent", label: "Absent", color: "var(--series-5)" },
];

const TYPE_LABELS: Record<string, string> = {
  permanent: "Permanent",
  probation: "Probation",
  contract: "Contract",
  intern: "Intern",
};

const LEAVE_NAMES: Record<string, string> = {
  CL: "Casual",
  SL: "Sick",
  EL: "Earned",
  MAT: "Maternity",
  PAT: "Paternity",
  COMPOFF: "Comp-off",
  LOP: "Unpaid",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Up to two initials. A leading "TEST" token (the marker on seeded test data) is ignored. */
function initials(name: string) {
  const words = name.split(/\s+/).filter((w) => w && w !== "TEST");
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function displayName(name: string) {
  return name.replace(/^TEST\s+/, "");
}

function dateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;
}

function greeting(): string {
  // Greeting by IST hour, independent of the server's time zone.
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Kpi(props: { icon: ReactNode; label: string; value: ReactNode; sub: ReactNode; tone?: "blue" | "green" | "violet" | "amber" }) {
  return (
    <section className={`kpi kpi-${props.tone ?? "blue"}`} aria-label={props.label}>
      <div className="kpi-icon">{props.icon}</div>
      <div className="kpi-body">
        <p className="kpi-label">{props.label}</p>
        <p className="kpi-value">{props.value}</p>
        <p className="kpi-sub">{props.sub}</p>
      </div>
    </section>
  );
}

function BarList({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="bar-label">{r.name}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="bar-value">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function HrDashboardView({ data, userName }: { data: HrDashboard; userName: string }) {
  const { headcount, onLeave, pending, attendance, holidays, recentJoiners, attention, byDepartment } = data;
  const total = headcount.total;
  const working = (attendance.counts.present ?? 0) + (attendance.counts.wfh ?? 0) + (attendance.counts.half_day ?? 0);
  const presentPct = attendance.recorded > 0 && total > 0 ? Math.round((working / total) * 100) : null;
  const flagged =
    (attention.withoutManager > 0 ? 1 : 0) + (attention.notSignedIn > 0 ? 1 : 0) + (pending.count > 0 ? 1 : 0);

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>
            {greeting()}, {displayName(userName).split(" ")[0]}
          </h1>
          <p className="muted">
            {weekdayName(data.today)}, {formatDate(data.today)} (IST). Here is how Konkan Coastal Foods looks today.
          </p>
        </div>
        <ul className="quick-actions" aria-label="Quick actions">
          {["Add employee", "Review leave", "Run report"].map((a) => (
            <li key={a}>
              <button type="button" className="btn btn-secondary btn-small" disabled aria-disabled="true">
                {a}
                <span className="btn-soon">Soon</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="kpi-grid">
        <Kpi
          tone="blue"
          icon={icons.people}
          label="Active employees"
          value={total}
          sub={
            headcount.byLocation.length > 0
              ? headcount.byLocation.map((l) => `${l.name} ${l.count}`).join(" · ")
              : "No active employees yet"
          }
        />
        <Kpi
          tone="green"
          icon={icons.check}
          label="Working today"
          value={presentPct === null ? "–" : `${presentPct}%`}
          sub={
            presentPct === null
              ? "Attendance not recorded yet"
              : `${working} of ${total} present, remote or half day`
          }
        />
        <Kpi
          tone="violet"
          icon={icons.leave}
          label="On leave today"
          value={onLeave.length}
          sub={onLeave.length === 0 ? "Nobody is away" : "Approved leave"}
        />
        <Kpi
          tone="amber"
          icon={icons.clock}
          label="Pending approvals"
          value={pending.count}
          sub={
            pending.count === 0
              ? "Nothing is waiting"
              : `Oldest waiting ${plural(pending.oldestAgeDays ?? 0, "day", "days")}`
          }
        />
      </div>

      <div className="dash-layout">
        <div className="dash-main">
          <section className="panel" aria-labelledby="p-approvals">
            <div className="panel-head">
              <h2 id="p-approvals">Leave requests waiting for a decision</h2>
              <span className="chip">{pending.count} pending</span>
            </div>
            {pending.items.length === 0 ? (
              <p className="empty">No leave requests are waiting. Nice and clear.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Leave</th>
                      <th scope="col">Dates</th>
                      <th scope="col" className="num">
                        Days
                      </th>
                      <th scope="col" className="num">
                        Waiting
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.items.map((r) => (
                      <tr key={`${r.employeeCode}-${r.startDate}`}>
                        <td>
                          <span className="person">
                            <Avatar name={r.fullName} />
                            <span>
                              {displayName(r.fullName)}
                              <span className="sub">{r.employeeCode}</span>
                            </span>
                          </span>
                        </td>
                        <td>{LEAVE_NAMES[r.leaveCode] ?? r.leaveCode}</td>
                        <td>{dateRange(r.startDate, r.endDate)}</td>
                        <td className="num">{r.days}</td>
                        <td className="num">
                          <span className={r.waitingDays >= 5 ? "chip chip-warn" : "chip"}>
                            {r.waitingDays === 0 ? "Today" : plural(r.waitingDays, "day", "days")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="p-attendance">
            <div className="panel-head">
              <h2 id="p-attendance">Attendance today</h2>
              <span className="muted">{attendance.recorded} of {total} recorded</span>
            </div>
            {attendance.recorded === 0 ? (
              <p className="empty">No attendance has been recorded for today yet.</p>
            ) : (
              <>
                <div
                  className="stack"
                  role="img"
                  aria-label={ATTENDANCE.map((a) => `${a.label} ${attendance.counts[a.key] ?? 0}`).join(", ")}
                >
                  {ATTENDANCE.map((a) => {
                    const n = attendance.counts[a.key] ?? 0;
                    return n > 0 ? (
                      <span key={a.key} className="stack-seg" style={{ flexGrow: n, background: a.color }} title={`${a.label}: ${n}`} />
                    ) : null;
                  })}
                  {attendance.notRecorded > 0 ? (
                    <span className="stack-seg stack-none" style={{ flexGrow: attendance.notRecorded }} title={`Not recorded: ${attendance.notRecorded}`} />
                  ) : null}
                </div>
                <ul className="legend">
                  {ATTENDANCE.map((a) => (
                    <li key={a.key}>
                      <span className="swatch" style={{ background: a.color }} aria-hidden="true" />
                      <span>{a.label}</span>
                      <strong>{attendance.counts[a.key] ?? 0}</strong>
                    </li>
                  ))}
                  {attendance.notRecorded > 0 ? (
                    <li>
                      <span className="swatch swatch-none" aria-hidden="true" />
                      <span>Not recorded</span>
                      <strong>{attendance.notRecorded}</strong>
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </section>

          <div className="two-col">
            <section className="panel" aria-labelledby="p-loc">
              <div className="panel-head">
                <h2 id="p-loc">Headcount by location</h2>
              </div>
              {headcount.byLocation.length === 0 ? <p className="empty">No data yet.</p> : <BarList rows={headcount.byLocation} />}
              {headcount.byType.length > 0 ? (
                <ul className="inline-list muted type-list" aria-label="By employment type">
                  {headcount.byType.map((t) => (
                    <li key={t.type}>
                      {TYPE_LABELS[t.type] ?? t.type} <strong>{t.count}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="panel" aria-labelledby="p-dept">
              <div className="panel-head">
                <h2 id="p-dept">Headcount by department</h2>
              </div>
              {byDepartment.length === 0 ? <p className="empty">No data yet.</p> : <BarList rows={byDepartment} />}
            </section>
          </div>

          <section className="panel" aria-labelledby="p-out">
            <div className="panel-head">
              <h2 id="p-out">Who is out today</h2>
              <span className="chip">{onLeave.length}</span>
            </div>
            {onLeave.length === 0 ? (
              <p className="empty">Nobody is on approved leave today.</p>
            ) : (
              <ul className="rows">
                {onLeave.slice(0, 8).map((p) => (
                  <li key={p.employeeCode}>
                    <span className="person">
                      <Avatar name={p.fullName} />
                      <span>
                        {displayName(p.fullName)}
                        <span className="sub">{p.employeeCode}</span>
                      </span>
                    </span>
                    <span className="row-meta">
                      {LEAVE_NAMES[p.leaveCode] ?? p.leaveCode} leave
                      <span className="sub">Until {formatDate(p.endDate)}</span>
                    </span>
                  </li>
                ))}
                {onLeave.length > 8 ? <li className="muted">and {onLeave.length - 8} more</li> : null}
              </ul>
            )}
          </section>
        </div>

        <aside className="dash-side" aria-label="Highlights">
          <section className="panel" aria-labelledby="p-attention">
            <div className="panel-head">
              <h2 id="p-attention">Needs attention</h2>
              {flagged > 0 ? <span className="chip chip-warn">{flagged}</span> : null}
            </div>
            {flagged === 0 ? (
              <p className="empty">Nothing needs attention.</p>
            ) : (
              <ul className="rows">
                {pending.count > 0 ? (
                  <li className="attn">
                    <span className="attn-icon">{icons.clock}</span>
                    <span>
                      Leave requests waiting
                      <span className="sub">Needs a decision</span>
                    </span>
                    <strong>{pending.count}</strong>
                  </li>
                ) : null}
                {attention.withoutManager > 0 ? (
                  <li className="attn">
                    <span className="attn-icon">{icons.alert}</span>
                    <span>
                      No reporting manager
                      <span className="sub">Approvals will go to HR</span>
                    </span>
                    <strong>{attention.withoutManager}</strong>
                  </li>
                ) : null}
                {attention.notSignedIn > 0 ? (
                  <li className="attn">
                    <span className="attn-icon">{icons.people}</span>
                    <span>
                      Not yet signed in
                      <span className="sub">No linked account</span>
                    </span>
                    <strong>{attention.notSignedIn}</strong>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="p-holidays">
            <div className="panel-head">
              <h2 id="p-holidays">Upcoming holidays</h2>
            </div>
            {holidays.length === 0 ? (
              <p className="empty">No upcoming holidays are set up.</p>
            ) : (
              <ul className="rows">
                {holidays.map((h) => {
                  const [, m, d] = h.date.split("-").map(Number);
                  const away = daysBetween(data.today, h.date);
                  return (
                    <li key={`${h.date}-${h.name}`}>
                      <span className="person">
                        <span className="date-tile" aria-hidden="true">
                          <span className="date-month">{MONTHS[m - 1]}</span>
                          <span className="date-day">{d}</span>
                        </span>
                        <span>
                          {h.name}
                          <span className="sub">
                            {weekdayName(h.date)}, {away === 0 ? "today" : `in ${plural(away, "day", "days")}`}
                          </span>
                        </span>
                      </span>
                      {!h.verified ? <span className="chip chip-warn">Tentative</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="p-joiners">
            <div className="panel-head">
              <h2 id="p-joiners">New joiners</h2>
              <span className="muted">Last 30 days</span>
            </div>
            {recentJoiners.length === 0 ? (
              <p className="empty">Nobody has joined in the last 30 days.</p>
            ) : (
              <ul className="rows">
                {recentJoiners.map((p) => (
                  <li key={p.employeeCode}>
                    <span className="person">
                      <Avatar name={p.fullName} />
                      <span>
                        {displayName(p.fullName)}
                        <span className="sub">
                          {p.designation}, {p.location}
                        </span>
                      </span>
                    </span>
                    <span className="muted">{formatDate(p.joiningDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
