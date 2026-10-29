"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { addDays, addMonths, formatDate } from "@/shared/dates";
import { countLeaveDays, fmtDays, maternityWeeks, PATERNITY_DAYS } from "@/modules/leave/rules";
import type { FormState } from "../actions";

function Field(props: { name: string; label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={props.name}>
        {props.label}
        {props.required ? <span className="req"> *</span> : <span className="opt"> (optional)</span>}
      </label>
      {props.children}
      {props.hint ? <p className="hint">{props.hint}</p> : null}
      {props.error ? <p className="field-error" id={`${props.name}-error`}>{props.error}</p> : null}
    </div>
  );
}

function Alerts({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {state.field ? `Please fix the highlighted detail: ${state.error}` : state.error}
    </div>
  );
}

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function MaternityForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [start, setStart] = useState(state.values?.startDate ?? "");
  const [children, setChildren] = useState(state.values?.survivingChildren ?? "0");
  const err = (n: string) => (state.field === n ? state.error : undefined);

  const preview = useMemo(() => {
    const kids = Number(children);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(kids) || kids < 0) return null;
    const weeks = maternityWeeks(kids);
    return { weeks, days: weeks * 7, end: addDays(start, weeks * 7 - 1) };
  }, [start, children]);

  return (
    <form action={formAction} className="form" noValidate>
      <Alerts state={state} />
      <div className="form-grid">
        <Field name="expectedDeliveryDate" label="Expected delivery date" required error={err("expectedDeliveryDate")}>
          <input id="expectedDeliveryDate" name="expectedDeliveryDate" type="date" defaultValue={state.values?.expectedDeliveryDate ?? ""} aria-invalid={!!err("expectedDeliveryDate") || undefined} />
        </Field>
        <Field name="survivingChildren" label="Surviving children you already have" required error={err("survivingChildren")} hint="Two or more gives 12 weeks, fewer than two gives 26 weeks.">
          <input id="survivingChildren" name="survivingChildren" type="text" inputMode="numeric" value={children} onChange={(e) => setChildren(e.target.value)} aria-invalid={!!err("survivingChildren") || undefined} />
        </Field>
        <Field name="startDate" label="Leave starts on" required error={err("startDate")} hint="Up to 8 weeks before the expected delivery date, and not after it.">
          <input id="startDate" name="startDate" type="date" min={addDays(today, -7)} value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!err("startDate") || undefined} />
        </Field>
      </div>
      <div className="preview" aria-live="polite">
        {preview ? (
          <>
            <p className="preview-main">
              Entitlement: <strong>{preview.weeks} weeks</strong> ({preview.days} calendar days)
            </p>
            <p className="muted">Your leave would end on {formatDate(preview.end)}. Weekly offs and holidays inside it are included.</p>
          </>
        ) : (
          <p className="muted">Enter your start date and number of children to see your entitlement and end date.</p>
        )}
        <p className="hint">A medical certificate is needed. Give it to HR. Maternity leave has no balance and does not use your other leave.</p>
      </div>
      <Field name="reason" label="Note for your manager" error={err("reason")}>
        <textarea id="reason" name="reason" rows={3} maxLength={300} defaultValue={state.values?.reason ?? ""} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? "Sending…" : "Send for approval"}</button>
        <Link className="btn btn-secondary btn-small" href="/app/leave">Cancel</Link>
      </div>
    </form>
  );
}

export function PaternityForm({
  action,
  weeklyOffDays,
  holidays,
}: {
  action: Action;
  weeklyOffDays: number[];
  holidays: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [birth, setBirth] = useState(state.values?.birthDate ?? "");
  const [start, setStart] = useState(state.values?.startDate ?? "");
  const [end, setEnd] = useState(state.values?.endDate ?? "");
  const err = (n: string) => (state.field === n ? state.error : undefined);

  const preview = useMemo(() => {
    const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!ok(start) || !ok(end)) return null;
    const counted = countLeaveDays({ start, end, dayPart: "full", weeklyOffDays, holidays });
    return { counted, windowEnd: ok(birth) ? addMonths(birth, 3) : null };
  }, [birth, start, end, weeklyOffDays, holidays]);

  return (
    <form action={formAction} className="form" noValidate>
      <Alerts state={state} />
      <div className="form-grid">
        <Field name="birthDate" label="Child's date of birth" required error={err("birthDate")}>
          <input id="birthDate" name="birthDate" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} aria-invalid={!!err("birthDate") || undefined} />
        </Field>
        <div />
        <Field name="startDate" label="From" required error={err("startDate")}>
          <input id="startDate" name="startDate" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} aria-invalid={!!err("startDate") || undefined} />
        </Field>
        <Field name="endDate" label="To" required error={err("endDate")}>
          <input id="endDate" name="endDate" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!err("endDate") || undefined} />
        </Field>
      </div>
      <div className="preview" aria-live="polite">
        {preview ? (
          <>
            <p className="preview-main">
              Working days counted: <strong>{fmtDays(preview.counted.days).replace(/ days?$/, "")}</strong> of {PATERNITY_DAYS}
            </p>
            {preview.windowEnd ? <p className="muted">It must be taken by {formatDate(preview.windowEnd)} (3 months after the birth).</p> : null}
          </>
        ) : (
          <p className="muted">Paternity leave is {PATERNITY_DAYS} working days for each child, taken within 3 months of the birth. You can split it across requests.</p>
        )}
      </div>
      <Field name="reason" label="Note for your manager" error={err("reason")}>
        <textarea id="reason" name="reason" rows={3} maxLength={300} defaultValue={state.values?.reason ?? ""} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? "Sending…" : "Send for approval"}</button>
        <Link className="btn btn-secondary btn-small" href="/app/leave">Cancel</Link>
      </div>
    </form>
  );
}

export function CompoffForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const err = (n: string) => (state.field === n ? state.error : undefined);
  return (
    <form action={formAction} className="form" noValidate>
      <Alerts state={state} />
      <div className="form-grid">
        <Field name="workedDate" label="The day you worked" required error={err("workedDate")} hint="A weekly off or holiday, within the last 30 days.">
          <input id="workedDate" name="workedDate" type="date" defaultValue={state.values?.workedDate ?? ""} aria-invalid={!!err("workedDate") || undefined} />
        </Field>
        <Field name="part" label="How much" required error={err("part")}>
          <select id="part" name="part" defaultValue={state.values?.part ?? "full"}>
            <option value="full">A full day (1 day of comp-off)</option>
            <option value="half">Half a day (0.5 day of comp-off)</option>
          </select>
        </Field>
      </div>
      <Field name="reason" label="What did you work on?" error={err("reason")}>
        <textarea id="reason" name="reason" rows={3} maxLength={300} defaultValue={state.values?.reason ?? ""} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>{pending ? "Sending…" : "Request comp-off"}</button>
        <Link className="btn btn-secondary btn-small" href="/app/leave">Cancel</Link>
      </div>
    </form>
  );
}
