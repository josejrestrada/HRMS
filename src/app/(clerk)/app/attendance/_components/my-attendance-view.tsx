import Link from "next/link";
import { formatDate, weekdayName } from "@/shared/dates";
import type { MyAttendance } from "@/modules/attendance/data";
import { formatMinutes } from "@/modules/attendance/rules";
import { punchAction } from "../actions";
import { AttendanceTabs } from "./attendance-tabs";
import { STATUS_INFO, StatusChip } from "./status";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLink(year: number, month: number) {
  return `/app/attendance?m=${year}-${String(month).padStart(2, "0")}`;
}

export function MyAttendanceView(props: { data: MyAttendance; isHr: boolean; saved?: string; time?: string; error?: string }) {
  const { data } = props;
  const prev = data.month === 1 ? { y: data.year - 1, m: 12 } : { y: data.year, m: data.month - 1 };
  const next = data.month === 12 ? { y: data.year + 1, m: 1 } : { y: data.year, m: data.month + 1 };
  const todayDay = data.days.find((d) => d.date === data.today);
  const s = data.summary;

  // Monday-first calendar: blank cells before the 1st.
  const firstWeekday = (new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <>
      <div className="page-head">
        <h1>Attendance</h1>
        <p className="muted">Your check-ins and how each day counts.</p>
      </div>
      <AttendanceTabs current="my" isHr={props.isHr} />

      {props.saved ? (
        <div className="alert alert-ok" role="status">
          You checked {props.saved === "in" ? "in" : "out"} at {props.time}.
        </div>
      ) : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel punch-card" aria-labelledby="p-today">
        <div>
          <h2 id="p-today">Today, {weekdayName(data.today)} {formatDate(data.today)}</h2>
          <p className="muted">
            {data.todayIn ? `Checked in at ${data.todayIn}` : "You have not checked in yet"}
            {data.todayOut ? `, checked out at ${data.todayOut}` : ""}.
            {todayDay?.status === "holiday" || todayDay?.status === "weekly_off" ? ` Today is ${STATUS_INFO[todayDay.status].label.toLowerCase()}.` : ""}
          </p>
          {todayDay ? <StatusChip status={todayDay.status} provisional={todayDay.provisional} /> : null}
        </div>
        {data.canPunch ? (
          <form action={punchAction}>
            <button type="submit" className={data.next === "in" ? "btn btn-primary punch-btn" : "btn btn-secondary punch-btn"}>
              {data.next === "in" ? "Check in" : "Check out"}
            </button>
          </form>
        ) : null}
      </section>

      <div className="month-nav">
        <Link className="btn btn-secondary btn-small" href={monthLink(prev.y, prev.m)} aria-label="Previous month">
          Previous
        </Link>
        <h2>
          {MONTH_NAMES[data.month - 1]} {data.year}
        </h2>
        <Link className="btn btn-secondary btn-small" href={monthLink(next.y, next.m)} aria-label="Next month">
          Next
        </Link>
      </div>

      <div className="att-summary">
        {(
          [
            ["Present", s.counts.present],
            ["Half days", s.counts.half_day],
            ["On leave", s.counts.leave],
            ["Work from home", s.counts.wfh],
            ["Absent", s.counts.absent + s.counts.missed_punch],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="att-stat">
            <p className="att-stat-value">{n}</p>
            <p className="muted">{label}</p>
          </div>
        ))}
        <div className="att-stat">
          <p className="att-stat-value">
            {s.lateMarks} <span className="unit">of {s.lateLimit}</span>
          </p>
          <p className="muted">Late marks this month</p>
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
            const isToday = d.date === data.today;
            return (
              <div key={d.date} role="gridcell" className={`cal-cell ${info.cls}${isToday ? " cal-today" : ""}`}>
                <span className="cal-date">{Number(d.date.slice(8))}</span>
                {d.status !== "upcoming" ? (
                  <span className="cal-status">{d.provisional && d.status === "absent" ? "Not in yet" : info.short}</span>
                ) : null}
                {d.firstIn ? (
                  <span className="cal-times">
                    {d.firstIn}
                    {d.lastOut ? `–${d.lastOut}` : ""}
                  </span>
                ) : null}
                {d.late ? <span className="cal-late">Late</span> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" aria-labelledby="p-fix">
        <div className="panel-head">
          <h2 id="p-fix">Days to fix</h2>
          <span className="chip">{s.needsAction.length}</span>
        </div>
        {s.needsAction.length === 0 ? (
          <p className="empty">Nothing needs fixing this month.</p>
        ) : (
          <>
            <ul className="rows">
              {data.days
                .filter((d) => d.needsAction)
                .map((d) => (
                  <li key={d.date}>
                    <span>
                      {weekdayName(d.date).slice(0, 3)} {formatDate(d.date)}
                      <span className="sub">
                        {d.note}
                        {d.workedMinutes !== null && d.status === "absent" ? "" : ""}
                      </span>
                    </span>
                    <StatusChip status={d.status} />
                  </li>
                ))}
            </ul>
            <p className="hint">
              Fixing a missed or short day (regularization) is coming next. Until then, please tell HR about any day that is wrong. Days not fixed by the
              {" "}{data.policy.regularizeUntilDay}th of next month will count as unpaid.
            </p>
          </>
        )}
      </section>
    </>
  );
}
