import Link from "next/link";
import { formatDate } from "@/shared/dates";
import type { Statement } from "@/modules/leave/data";
import { fmtDays } from "@/modules/leave/rules";

const REASONS: Record<string, string> = {
  grant: "Yearly grant",
  accrual: "Monthly accrual",
  opening_balance: "Opening balance",
  pending_hold: "Held for a pending request",
  hold_release: "Hold released",
  application: "Leave taken",
  cancellation: "Leave cancelled",
  lapse: "Lapsed at year end",
  carry_forward: "Carried forward",
  encashment: "Encashed",
  expiry: "Expired",
  adjustment: "Adjustment by HR",
};

export function StatementView({ statement }: { statement: Statement }) {
  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/app/leave">My leave</Link> / {statement.name}
        </p>
        <h1>{statement.name} statement</h1>
        <p className="muted">
          Balance {fmtDays(statement.balance)}
          {statement.held > 0 ? `, of which ${fmtDays(statement.held)} is held for pending requests` : ""}. Every change to your balance is listed here with its reason.
        </p>
      </div>
      <section className="panel" aria-label="Statement">
        {statement.entries.length === 0 ? (
          <p className="empty">No entries yet. Credits appear here once HR has added your leave for the year.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What happened</th>
                  <th scope="col" className="num">Change</th>
                  <th scope="col" className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.map((e) => (
                  <tr key={e.id} className={e.isHold ? "row-hold" : undefined}>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      {REASONS[e.reason] ?? e.reason}
                      {e.note ? <span className="sub">{e.note}</span> : null}
                    </td>
                    <td className="num">{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                    <td className="num">{e.running === null ? <span className="muted">not counted</span> : e.running}</td>
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
