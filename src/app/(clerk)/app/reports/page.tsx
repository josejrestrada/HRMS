import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { todayIST } from "@/shared/dates";
import { REPORT_KINDS, buildReport, type Report } from "@/modules/reports/data";
import { NoAccess, NotLinked } from "../_components/ui";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const NAMES: Record<string, string> = { headcount: "Headcount", "leave-balances": "Leave balances", "attendance-summary": "Attendance summary" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  if (!actor.roles.includes("hr_admin")) return <NoAccess />;
  const sp = await searchParams;

  const today = todayIST();
  const kind = REPORT_KINDS.find((k) => k === first(sp.report)) ?? "headcount";
  const year = Number(first(sp.year)) || Number(today.slice(0, 4));
  const month = Number(first(sp.month)) || Number(today.slice(5, 7));

  let report: Report | undefined;
  let error: string | undefined;
  try {
    report = await buildReport(actor, kind, { year, month });
  } catch (err) {
    if (err instanceof DomainError) error = err.message;
    else throw err;
  }
  const csvHref = `/app/reports/download?report=${kind}${kind === "attendance-summary" ? `&year=${year}&month=${month}` : ""}`;

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <p className="muted">Read-only reports for HR. Each one can be downloaded as a CSV file for a spreadsheet.</p>
      </div>

      <form className="filters" method="get" action="/app/reports" aria-label="Choose a report">
        <div className="filter">
          <label htmlFor="report">Report</label>
          <select id="report" name="report" defaultValue={kind}>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k}>{NAMES[k]}</option>
            ))}
          </select>
        </div>
        {kind === "attendance-summary" ? (
          <>
            <div className="filter">
              <label htmlFor="month">Month</label>
              <select id="month" name="month" defaultValue={month}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="filter">
              <label htmlFor="year">Year</label>
              <input id="year" name="year" type="number" min={2000} max={2100} defaultValue={year} />
            </div>
          </>
        ) : null}
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary btn-small">Run report</button>
          {report ? <a className="btn btn-secondary btn-small" href={csvHref}>Download CSV</a> : null}
        </div>
      </form>

      {error ? <p role="alert" className="alert alert-error">{error}</p> : null}

      {report ? (
        <section className="panel" aria-labelledby="r-title">
          <div className="panel-head">
            <h2 id="r-title">{report.title}</h2>
            <span className="muted">{report.subtitle}</span>
          </div>
          {report.rows.length === 0 ? (
            <p className="empty">Nothing to show for this report.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {report.header.map((h, i) => (
                      <th key={h} scope="col" className={i >= report.numericFrom ? "num" : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={String(r[0])}>
                      {r.map((c, i) => (
                        <td key={report.header[i]} className={i >= report.numericFrom ? "num" : undefined}>{c ?? "–"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
