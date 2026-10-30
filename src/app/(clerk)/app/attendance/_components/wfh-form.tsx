"use client";

import { useActionState, useState } from "react";
import type { FormState } from "../actions";

export function WfhForm(props: { action: (prev: FormState, formData: FormData) => Promise<FormState>; today: string; latest: string }) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [start, setStart] = useState(state.values?.startDate ?? props.today);
  const [end, setEnd] = useState(state.values?.endDate ?? props.today);

  return (
    <form action={formAction} className="form" noValidate>
      {state.error ? <div className="alert alert-error" role="alert">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="startDate">
          From<span className="req"> *</span>
        </label>
        <input id="startDate" name="startDate" type="date" min={props.today} max={props.latest} value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
      </div>
      <div className="field">
        <label htmlFor="endDate">
          To<span className="req"> *</span>
        </label>
        <input id="endDate" name="endDate" type="date" min={start} max={props.latest} value={end} onChange={(e) => setEnd(e.target.value)} />
        <p className="hint">Weekly offs, holidays and days of leave in between are skipped.</p>
      </div>
      <div className="field">
        <label htmlFor="reason">
          Reason<span className="req"> *</span>
        </label>
        <input id="reason" name="reason" type="text" maxLength={300} defaultValue={state.values?.reason ?? ""} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sending…" : "Send for approval"}
      </button>
    </form>
  );
}
