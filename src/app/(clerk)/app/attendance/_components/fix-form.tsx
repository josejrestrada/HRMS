"use client";

import { useActionState } from "react";
import { formatDate, weekdayName } from "@/shared/dates";
import type { FormState } from "../actions";

type Props = {
  days: { date: string; note: string | null }[];
  defaults: { in: string; out: string };
  deadlineText: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
};

export function FixForm({ days, defaults, deadlineText, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const ticked = (date: string) => (state.values?.days ? state.values.days.split(",").includes(date) : true);

  return (
    <form action={formAction} className="form" noValidate>
      {state.error ? <div className="alert alert-error" role="alert">{state.error}</div> : null}
      <fieldset className="fieldset">
        <legend>Tick the days to fix and check the times</legend>
        <ul className="fix-list">
          {days.map((d) => (
            <li key={d.date} className="fix-row">
              <label className="fix-day">
                <input type="checkbox" name="days" value={d.date} defaultChecked={ticked(d.date)} />
                <span>
                  {weekdayName(d.date).slice(0, 3)} {formatDate(d.date)}
                  <span className="sub">{d.note}</span>
                </span>
              </label>
              <div className="fix-times">
                <label>
                  <span className="sr-only">Check-in time for {formatDate(d.date)}</span>
                  <input type="time" name={`in_${d.date}`} defaultValue={state.values?.[`in_${d.date}`] ?? defaults.in} />
                </label>
                <span aria-hidden="true">to</span>
                <label>
                  <span className="sr-only">Check-out time for {formatDate(d.date)}</span>
                  <input type="time" name={`out_${d.date}`} defaultValue={state.values?.[`out_${d.date}`] ?? defaults.out} />
                </label>
              </div>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="field">
        <label htmlFor="reason">
          Reason for all ticked days<span className="req"> *</span>
        </label>
        <textarea id="reason" name="reason" rows={2} maxLength={300} defaultValue={state.values?.reason ?? ""} placeholder="For example: forgot to check out, machine was down" />
        <p className="hint">{deadlineText}</p>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? "Sending…" : "Send for approval"}
        </button>
      </div>
    </form>
  );
}
