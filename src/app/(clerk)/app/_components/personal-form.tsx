"use client";

import { useActionState, useEffect, useState } from "react";
import type { PersonalDetails } from "@/modules/employees/personal";
import { revealPanAction, savePersonalAction, type PersonalState } from "../personal/actions";

// The stored PAN is never sent to the page. The boxes start empty; a blank box leaves the stored value as it is.

function RevealPan({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState<PersonalState, FormData>(revealPanAction, {});
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!state.revealed) return;
    setShown(state.revealed);
    const timer = setTimeout(() => setShown(null), 30_000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  return (
    <form action={action} className="reveal">
      <input type="hidden" name="employeeId" value={employeeId} />
      {shown ? (
        <p>
          <strong className="mono">{shown}</strong> <span className="muted">Hidden again in 30 seconds. This view was recorded.</span>
        </p>
      ) : (
        <button type="submit" className="btn btn-secondary btn-small" disabled={pending}>
          Reveal PAN
        </button>
      )}
      {state.error ? (
        <p role="alert" className="field-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function PersonalForm({ details, isHr }: { details: PersonalDetails; isHr: boolean }) {
  const [state, action, pending] = useActionState<PersonalState, FormData>(savePersonalAction, {});

  return (
    <>
      <dl className="facts">
        <div>
          <dt>PAN</dt>
          <dd>{details.panMasked ?? <span className="muted">Not added</span>}</dd>
        </div>
        <div>
          <dt>Aadhaar</dt>
          <dd>
            {details.aadhaarMasked ?? <span className="muted">Not added</span>}
            {details.aadhaarMasked ? <span className={details.aadhaarVerified ? "chip chip-ok" : "chip"}>{details.aadhaarVerified ? "Verified" : "Not verified"}</span> : null}
          </dd>
        </div>
      </dl>
      {isHr && details.panMasked ? <RevealPan employeeId={details.employeeId} /> : null}

      <form action={action} className="form" noValidate>
        <input type="hidden" name="employeeId" value={details.employeeId} />
        {isHr ? <input type="hidden" name="hrForm" value="1" /> : null}
        {state.error ? (
          <div className="alert alert-error" role="alert">
            {state.error}
          </div>
        ) : null}
        {state.saved ? (
          <div className="alert alert-ok" role="status">
            Saved.
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="pan">{details.panMasked ? "Replace PAN" : "PAN"}</label>
          <input id="pan" name="pan" autoComplete="off" spellCheck={false} maxLength={10} placeholder="ABCDE1234F" aria-invalid={state.field === "pan" || undefined} />
          <p className="hint">Leave empty to keep the current PAN. It is stored encrypted and shown masked.</p>
        </div>
        <div className="field">
          <label htmlFor="aadhaarLast4">Last 4 digits of Aadhaar</label>
          <input id="aadhaarLast4" name="aadhaarLast4" inputMode="numeric" autoComplete="off" maxLength={4} placeholder="1234" aria-invalid={state.field === "aadhaarLast4" || undefined} />
          <p className="hint">Only the last 4 digits. The full Aadhaar number is never stored.</p>
        </div>
        {isHr ? (
          <div className="field">
            <label>
              <input type="checkbox" name="aadhaarVerified" defaultChecked={details.aadhaarVerified} /> Aadhaar checked and verified by HR
            </label>
          </div>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </>
  );
}
