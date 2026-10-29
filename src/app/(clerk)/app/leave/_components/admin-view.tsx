import { runLeaveCreditsAction } from "../actions";
import { LeaveTabs } from "./leave-tabs";

export function AdminView(props: {
  year: number;
  canApprove: boolean;
  pending: number;
  result?: { year: string; grants: string; accruals: string };
  error?: string;
}) {
  return (
    <>
      <div className="page-head">
        <h1>Leave admin</h1>
        <p className="muted">Add the yearly leave and the monthly earned leave to everyone&apos;s balance.</p>
      </div>
      <LeaveTabs current="admin" canApprove={props.canApprove} pending={props.pending} isHr />
      {props.result ? (
        <div className="alert alert-ok" role="status">
          Leave credits for {props.result.year}: {props.result.grants} yearly grants and {props.result.accruals} monthly accruals were added.
          {props.result.grants === "0" && props.result.accruals === "0" ? " Everything was already up to date." : ""}
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
    </>
  );
}
