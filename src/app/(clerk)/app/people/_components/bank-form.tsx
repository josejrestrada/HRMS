"use client";

import { useActionState, useEffect, useState } from "react";
import type { BankDetails } from "@/modules/employees/bank";
import { revealBankAction, saveBankAction, type BankState } from "../bank-actions";

// Stored secrets are never sent to the page. The boxes start empty; a blank box leaves the stored value as it is.

function Reveal({ employeeId, field, label }: { employeeId: string; field: "account" | "uan" | "salary"; label: string }) {
  const [state, action, pending] = useActionState<BankState, FormData>(revealBankAction, {});
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
      <input type="hidden" name="field" value={field} />
      {shown ? (
        <p>
          <strong className="mono">{field === "salary" ? `₹${Number(shown).toLocaleString("en-IN")} a month` : shown}</strong>{" "}
          <span className="muted">Hidden again in 30 seconds. This view was recorded.</span>
        </p>
      ) : (
        <button type="submit" className="btn btn-secondary btn-small" disabled={pending}>
          Reveal {label}
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

export function BankForm({ details }: { details: BankDetails }) {
  const [state, action, pending] = useActionState<BankState, FormData>(saveBankAction, {});
  const id = details.employeeId;
  const missing = <span className="muted">Not added</span>;

  return (
    <>
      <dl className="facts">
        <div>
          <dt>Account holder</dt>
          <dd>{details.accountHolder ?? missing}</dd>
        </div>
        <div>
          <dt>Bank and IFSC</dt>
          <dd>{details.bankName || details.ifsc ? [details.bankName, details.ifsc].filter(Boolean).join(" · ") : missing}</dd>
        </div>
        <div>
          <dt>Account number</dt>
          <dd>
            <span className="mono">{details.accountMasked ?? missing}</span>
            {details.accountMasked ? <Reveal employeeId={id} field="account" label="account number" /> : null}
          </dd>
        </div>
        <div>
          <dt>UAN</dt>
          <dd>
            <span className="mono">{details.uanMasked ?? missing}</span>
            {details.uanMasked ? <Reveal employeeId={id} field="uan" label="UAN" /> : null}
          </dd>
        </div>
        <div>
          <dt>Monthly salary</dt>
          <dd>
            {details.hasSalary ? <span className="mono">••••••</span> : missing}
            {details.hasSalary ? <Reveal employeeId={id} field="salary" label="salary" /> : null}
          </dd>
        </div>
      </dl>

      <form action={action} className="form" noValidate>
        <input type="hidden" name="employeeId" value={id} />
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
        <p className="hint">Leave a box empty to keep what is stored. Account number, UAN and salary are stored encrypted and shown masked.</p>
        <div className="field">
          <label htmlFor="accountHolder">Account holder name</label>
          <input id="accountHolder" name="accountHolder" autoComplete="off" maxLength={120} defaultValue={details.accountHolder ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="bankName">Bank name</label>
          <input id="bankName" name="bankName" autoComplete="off" maxLength={120} defaultValue={details.bankName ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ifsc">IFSC</label>
          <input id="ifsc" name="ifsc" autoComplete="off" spellCheck={false} maxLength={11} placeholder="SBIN0001234" defaultValue={details.ifsc ?? ""} aria-invalid={state.field === "ifsc" || undefined} />
        </div>
        <div className="field">
          <label htmlFor="account">{details.accountMasked ? "Replace account number" : "Account number"}</label>
          <input id="account" name="account" inputMode="numeric" autoComplete="off" maxLength={24} aria-invalid={state.field === "account" || undefined} />
        </div>
        <div className="field">
          <label htmlFor="uan">{details.uanMasked ? "Replace UAN" : "UAN"}</label>
          <input id="uan" name="uan" inputMode="numeric" autoComplete="off" maxLength={14} aria-invalid={state.field === "uan" || undefined} />
        </div>
        <div className="field">
          <label htmlFor="salary">{details.hasSalary ? "Replace monthly salary (₹)" : "Monthly salary (₹)"}</label>
          <input id="salary" name="salary" inputMode="numeric" autoComplete="off" maxLength={12} aria-invalid={state.field === "salary" || undefined} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Save
          </button>
        </div>
      </form>
    </>
  );
}
