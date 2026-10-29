"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { ApplyContext } from "@/modules/leave/data";
import { checkApplication, countLeaveDays, fmtDays, type DayPart } from "@/modules/leave/rules";
import { formatDate, weekdayName } from "@/shared/dates";
import type { FormState } from "../actions";

const RULE_LINES: Record<string, string> = {
  CL: "Casual leave: at most 3 days in a row.",
  SL: "Sick leave: a medical certificate is needed for more than 2 days.",
  EL: "Earned leave builds up each month and carries forward up to 45 days.",
  LOP: "Leave without pay: nothing is taken from your balances and your pay is reduced.",
};

function Field(props: { name: string; label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={props.name}>
        {props.label}
        {props.required ? <span className="req"> *</span> : <span className="opt"> (optional)</span>}
      </label>
      {props.children}
      {props.hint ? <p className="hint">{props.hint}</p> : null}
      {props.error ? (
        <p className="field-error" id={`${props.name}-error`}>
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function ApplyForm({
  context,
  action,
}: {
  context: ApplyContext;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [typeId, setTypeId] = useState(state.values?.leaveTypeId ?? context.types[0]?.id ?? "");
  const [start, setStart] = useState(state.values?.startDate ?? context.today);
  const [end, setEnd] = useState(state.values?.endDate ?? context.today);
  const [dayPart, setDayPart] = useState<DayPart>((state.values?.dayPart as DayPart) ?? "full");
  const [convert, setConvert] = useState(state.values?.convertShortfallToLop === "on");

  const type = context.types.find((t) => t.id === typeId);
  const complete = !!type && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);

  const preview = useMemo(() => {
    if (!complete || !type) return null;
    const counted = countLeaveDays({ start, end, dayPart, weeklyOffDays: context.weeklyOffDays, holidays: context.holidays });
    const check = checkApplication({
      today: context.today,
      start,
      end,
      dayPart,
      days: counted.days,
      typeCode: type.code,
      typeName: type.name,
      maxConsecutiveDays: type.maxConsecutiveDays,
      available: type.available,
      convertShortfallToLop: convert,
    });
    return { counted, check };
  }, [complete, type, start, end, dayPart, convert, context]);

  const err = (name: string) => (state.field === name ? state.error : undefined);
  const shortfall = preview && preview.counted.days > (type?.available ?? 0) && type?.code !== "LOP" && preview.counted.days > 0;

  return (
    <form action={formAction} className="form" noValidate>
      {state.error && !state.field ? <div className="alert alert-error" role="alert">{state.error}</div> : null}
      {state.error && state.field ? <div className="alert alert-error" role="alert">Please fix the highlighted detail: {state.error}</div> : null}

      <div className="form-grid">
        <Field name="leaveTypeId" label="Leave type" required error={err("leaveTypeId")}>
          <select id="leaveTypeId" name="leaveTypeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-invalid={!!err("leaveTypeId") || undefined}>
            {context.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.code === "LOP" ? "" : ` (${fmtDays(t.available)} available)`}
              </option>
            ))}
          </select>
          {type ? <p className="hint">{RULE_LINES[type.code] ?? ""}</p> : null}
        </Field>
        <Field name="dayPart" label="Day" required error={err("dayPart")}>
          <select id="dayPart" name="dayPart" value={dayPart} onChange={(e) => setDayPart(e.target.value as DayPart)} aria-invalid={!!err("dayPart") || undefined}>
            <option value="full">Full day(s)</option>
            <option value="first_half">First half only</option>
            <option value="second_half">Second half only</option>
          </select>
        </Field>
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
              Working days counted: <strong>{fmtDays(preview.counted.days).replace(/ days?$/, "")}</strong>
            </p>
            {preview.counted.skipped.length > 0 ? (
              <ul className="preview-skips">
                {preview.counted.skipped.map((s) => (
                  <li key={s.date}>
                    {weekdayName(s.date).slice(0, 3)} {formatDate(s.date)} is {s.reason === "weekly_off" ? "a weekly off" : (s.label ?? "a holiday")}, not counted
                  </li>
                ))}
              </ul>
            ) : null}
            {type && type.code !== "LOP" ? (
              <p className="muted">
                Balance after: {fmtDays(Math.max(0, type.available - preview.counted.days))}
                {preview.check.ok && preview.check.lopDays > 0 ? `, with ${fmtDays(preview.check.lopDays)} unpaid` : ""}
              </p>
            ) : null}
            {!preview.check.ok ? <p className="preview-warn">{preview.check.error}</p> : null}
            {preview.check.ok && preview.check.certificateRequired ? (
              <p className="preview-warn">A medical certificate is needed for this sick leave. Give it to HR.</p>
            ) : null}
            <p className="hint">Location: {context.locationName}. Weekly offs and holidays for your location are skipped.</p>
          </>
        ) : (
          <p className="muted">Choose your dates to see how many days will be counted.</p>
        )}
      </div>

      {shortfall ? (
        <label className="check">
          <input type="checkbox" name="convertShortfallToLop" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
          <span>
            Use the extra days as leave without pay. I understand my pay will be reduced for those days.
          </span>
        </label>
      ) : null}

      <Field name="reason" label="Reason" error={err("reason")}>
        <textarea id="reason" name="reason" rows={3} maxLength={300} defaultValue={state.values?.reason ?? ""} />
      </Field>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? "Sending…" : "Send for approval"}
        </button>
        <Link className="btn btn-secondary btn-small" href="/app/leave">
          Cancel
        </Link>
      </div>
    </form>
  );
}
