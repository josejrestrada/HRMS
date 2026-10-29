import type { YearEndSummary } from "@/modules/leave/data";
import { fmtDays } from "@/modules/leave/rules";
import { runCompoffExpiryAction, runLeaveCreditsAction, runYearEndAction } from "../actions";
import { LeaveTabs } from "./leave-tabs";

export type YearEndResult = { year: string; people: string; lines: { code: string; lapsed: number; encashed: number; carried: number }[] };

function YearEndTable({ lines }: { lines: { code: string; name?: string; people?: number; lapsed: number; encashed: number; carried: number }[] }) {
  if (lines.length === 0) return <p className="empty">Nothing to do: nobody has leave to carry, lapse or encash.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Leave type</th>
            <th scope="col" className="num">People</th>
            <th scope="col" className="num">Carried forward</th>
            <th scope="col" className="num">Lapsed</th>
            <th scope="col" className="num">To encash</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.code}>
              <td>{l.name ?? l.code}</td>
              <td className="num">{l.people ?? "–"}</td>
              <td className="num">{fmtDays(l.carried)}</td>
              <td className="num">{fmtDays(l.lapsed)}</td>
              <td className="num">{fmtDays(l.encashed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminView(props: {
  year: number;
  canApprove: boolean;
  pending: number;
  result?: { year: string; grants: string; accruals: string };
  yearEndResult?: YearEndResult;
  yearEndPreview?: YearEndSummary;
  yearEndYear: number;
  compoffResult?: { credits: string; days: string };
  error?: string;
}) {
  return (
    <>
      <div className="page-head">
        <h1>Leave admin</h1>
        <p className="muted">Add leave to everyone&apos;s balance, and close the year.</p>
      </div>
      <LeaveTabs current="admin" canApprove={props.canApprove} pending={props.pending} isHr />
      {props.result ? (
        <div className="alert alert-ok" role="status">
          Leave credits for {props.result.year}: {props.result.grants} yearly grants and {props.result.accruals} monthly accruals were added.
          {props.result.grants === "0" && props.result.accruals === "0" ? " Everything was already up to date." : ""}
        </div>
      ) : null}
      {props.yearEndResult ? (
        <div className="alert alert-ok" role="status">
          Year-end {props.yearEndResult.year} is done for {props.yearEndResult.people} {props.yearEndResult.people === "1" ? "person" : "people"}.
          {props.yearEndResult.lines.length === 0 ? " Nothing needed doing, or it had already been run." : ""}
        </div>
      ) : null}
      {props.compoffResult ? (
        <div className="alert alert-ok" role="status">
          Comp-off expiry: {props.compoffResult.days} days from {props.compoffResult.credits} credits were expired.
          {props.compoffResult.credits === "0" ? " Nothing had expired." : ""}
        </div>
      ) : null}
      {props.error ? <div className="alert alert-error" role="alert">{props.error}</div> : null}

      <section className="panel panel-form">
        <h2 className="panel-title">Run leave credits</h2>
        <ul className="plain-links bullets">
          <li>Casual and sick leave are granted for the year. People who joined this year get a pro-rated amount, never less than the Goa legal minimum.</li>
          <li>Earned leave is added for every month that has finished (1.5 days a month, reduced for unpaid leave).</li>
          <li>It is safe to run again: anything already added is skipped.</li>
        </ul>
        <form action={runLeaveCreditsAction} className="form">
          <div className="field">
            <label htmlFor="year">Year</label>
            <input id="year" name="year" type="text" inputMode="numeric" defaultValue={props.year} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-small">Run leave credits</button>
          </div>
        </form>
      </section>

      <section className="panel panel-form">
        <h2 className="panel-title">Expire old comp-off</h2>
        <p className="muted">
          Comp-off days last 60 days from approval. Expired days are already unavailable to employees; this writes the expiry to each
          statement. It is safe to run again.
        </p>
        <form action={runCompoffExpiryAction} className="form">
          <div className="form-actions">
            <button type="submit" className="btn btn-secondary btn-small">Expire old comp-off</button>
          </div>
        </form>
      </section>

      <section className="panel panel-form">
        <h2 className="panel-title">Year-end processing</h2>
        <ul className="plain-links bullets">
          <li>Casual and sick leave that is left lapses.</li>
          <li>Earned leave carries forward up to 45 days. Anything above that is marked for encashment.</li>
          <li>Days held for requests that are still pending are not touched.</li>
          <li>You see a preview first. Confirming is only possible from 31 December.</li>
        </ul>

        <form method="get" action="/app/leave/admin" className="form">
          <div className="field">
            <label htmlFor="yearEnd">Year to close</label>
            <input id="yearEnd" name="yearEnd" type="text" inputMode="numeric" defaultValue={props.yearEndYear} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-secondary btn-small">Preview year-end</button>
          </div>
        </form>

        {props.yearEndPreview ? (
          <div className="yearend-preview">
            <h3>Preview for {props.yearEndPreview.year}</h3>
            <p className="muted">
              {props.yearEndPreview.employees} {props.yearEndPreview.employees === 1 ? "person is" : "people are"} affected. Nothing has been changed yet.
            </p>
            <YearEndTable lines={props.yearEndPreview.lines} />
            {props.yearEndPreview.canRun ? (
              <form action={runYearEndAction} className="form">
                <input type="hidden" name="year" value={props.yearEndPreview.year} />
                <div className="form-actions">
                  <button type="submit" className="btn btn-danger btn-small">Confirm and close {props.yearEndPreview.year}</button>
                </div>
                <p className="hint">This writes entries to everyone&apos;s statement. They cannot be removed, only corrected with an adjustment.</p>
              </form>
            ) : (
              <p className="alert alert-error" role="status">
                Year-end can only be run from 31 December {props.yearEndPreview.year}. This is only a preview of what would happen today.
              </p>
            )}
          </div>
        ) : null}

        {props.yearEndResult && props.yearEndResult.lines.length > 0 ? (
          <div className="yearend-preview">
            <h3>Done for {props.yearEndResult.year}</h3>
            <YearEndTable lines={props.yearEndResult.lines} />
          </div>
        ) : null}
      </section>
    </>
  );
}
