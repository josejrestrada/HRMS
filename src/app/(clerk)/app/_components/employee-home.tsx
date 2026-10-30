import Link from "next/link";
import { formatDate, weekdayName } from "@/shared/dates";
import type { EmployeeHome } from "@/modules/reports/home";
import { fmtDays } from "@/modules/leave/rules";
import { STATUS_LABELS, dateRange, statusChipClass } from "./ui";
import { punchAction } from "../attendance/actions";

const KIND_LABEL = { holiday: "Holiday", leave: "Leave", wfh: "Work from home" } as const;

function greeting(name: string) {
  const first = name.replace(/^TEST\s+/, "").split(/\s+/)[0] ?? "";
  return first ? `Hello, ${first}` : "Hello";
}

export function EmployeeHomeView({ data, userName, punch = punchAction }: { data: EmployeeHome; userName: string; punch?: () => Promise<void> }) {
  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>{greeting(userName)}</h1>
          <p className="muted">{weekdayName(data.today)}, {formatDate(data.today)}</p>
        </div>
        <ul className="quick-actions" aria-label="Quick actions">
          <li>
            <Link className="btn btn-primary btn-small" href="/app/leave/apply">Apply leave</Link>
          </li>
          <li>
            <Link className="btn btn-secondary btn-small" href="/app/attendance">Regularize</Link>
          </li>
          <li>
            <Link className="btn btn-secondary btn-small" href="/app/attendance/wfh">Work from home</Link>
          </li>
        </ul>
      </div>

      {data.attention.length > 0 ? (
        <ul className="home-attention" aria-label="Needs your attention">
          {data.attention.map((a) => (
            <li key={a.text} className={a.tone === "warn" ? "alert alert-warn" : "alert"}>
              <Link href={a.href}>{a.text}</Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="panel home-today" aria-labelledby="h-today">
        <div>
          <h2 id="h-today">Today</h2>
          <p className="home-status">
            <span className={data.status.tone === "ok" ? "chip chip-ok" : "chip"}>{data.status.label}</span>
            {data.status.detail ? <span className="sub">{data.status.detail}</span> : null}
          </p>
        </div>
        {data.canPunch ? (
          <form action={punch}>
            <button type="submit" className="btn btn-primary">
              {data.next === "in" ? "Check in" : "Check out"}
            </button>
          </form>
        ) : null}
      </section>

      <div className="balance-grid">
        {data.balances.map((b) => (
          <section key={b.code} className="panel balance-card" aria-labelledby={`hb-${b.code}`}>
            <h2 id={`hb-${b.code}`}>{b.name}</h2>
            <p className="big">
              {fmtDays(b.available).replace(/ days?$/, "")}
              <span className="unit"> available</span>
            </p>
            <p className="muted">{b.held > 0 ? `${fmtDays(b.held)} held for pending requests.` : "Nothing is held."}</p>
            <Link href={`/app/leave/statement/${b.code}`} className="card-link">
              View statement
            </Link>
          </section>
        ))}
      </div>

      <section className="panel" aria-labelledby="h-upcoming">
        <div className="panel-head">
          <h2 id="h-upcoming">Upcoming</h2>
        </div>
        {data.upcoming.length === 0 ? (
          <p className="empty">Nothing is coming up.</p>
        ) : (
          <ul className="rows">
            {data.upcoming.map((u) => (
              <li key={`${u.kind}-${u.date}-${u.title}`}>
                <span>
                  {u.title}
                  <span className="sub">
                    {KIND_LABEL[u.kind]} &middot; {dateRange(u.date, u.endDate, formatDate)}
                  </span>
                </span>
                {u.status ? <span className={statusChipClass(u.status)}>{STATUS_LABELS[u.status]}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
