"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { PeopleLookups } from "@/modules/employees/data";
import type { FormState } from "../actions";

const TYPES = [
  ["permanent", "Permanent"],
  ["probation", "Probation"],
  ["contract", "Contract"],
  ["intern", "Intern"],
] as const;

type Props = {
  mode: "create" | "change";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  lookups: PeopleLookups;
  defaults?: Record<string, string>;
  employeeId?: string;
  cancelHref: string;
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

export function EmployeeForm({ mode, action, lookups, defaults = {}, employeeId, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const value = (name: string) => state.values?.[name] ?? defaults[name] ?? "";
  const invalid = (name: string) => state.field === name && !!state.error;

  const err = (name: string) => (invalid(name) ? state.error : undefined);

  const aria = (name: string) => ({
    "aria-invalid": invalid(name) || undefined,
    "aria-describedby": invalid(name) ? `${name}-error` : undefined,
  });

  const managers = lookups.managers.filter((m) => m.id !== employeeId);

  return (
    <form action={formAction} className="form" noValidate>
      {employeeId ? <input type="hidden" name="employeeId" value={employeeId} /> : null}

      {state.error && !state.field ? (
        <div className="alert alert-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.error && state.field ? (
        <div className="alert alert-error" role="alert">
          Please fix the highlighted detail: {state.error}
        </div>
      ) : null}

      {mode === "create" ? (
        <fieldset className="fieldset">
          <legend>Person</legend>
          <div className="form-grid">
            <Field error={err("fullName")} name="fullName" label="Full name" required>
              <input id="fullName" name="fullName" type="text" autoComplete="off" defaultValue={value("fullName")} {...aria("fullName")} />
            </Field>
            <Field error={err("workEmail")} name="workEmail" label="Work email" required hint="They will sign in with this email.">
              <input id="workEmail" name="workEmail" type="email" autoComplete="off" defaultValue={value("workEmail")} {...aria("workEmail")} />
            </Field>
            <Field error={err("gender")} name="gender" label="Gender">
              <select id="gender" name="gender" defaultValue={value("gender")} {...aria("gender")}>
                <option value="">Not stated</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field error={err("dateOfBirth")} name="dateOfBirth" label="Date of birth">
              <input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={value("dateOfBirth")} {...aria("dateOfBirth")} />
            </Field>
            <Field error={err("joiningDate")} name="joiningDate" label="Joining date" required>
              <input id="joiningDate" name="joiningDate" type="date" defaultValue={value("joiningDate")} {...aria("joiningDate")} />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="fieldset">
        <legend>{mode === "create" ? "Job" : "New assignment"}</legend>
        <div className="form-grid">
          {mode === "change" ? (
            <Field error={err("effectiveFrom")} name="effectiveFrom" label="Effective from" required hint="The old assignment ends the day before. History is kept.">
              <input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={value("effectiveFrom")} {...aria("effectiveFrom")} />
            </Field>
          ) : null}
          <Field error={err("locationId")} name="locationId" label="Location" required>
            <select id="locationId" name="locationId" defaultValue={value("locationId")} {...aria("locationId")}>
              <option value="">Choose a location</option>
              {lookups.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field error={err("department")} name="department" label="Department" required>
            <input id="department" name="department" type="text" list="departments" autoComplete="off" defaultValue={value("department")} {...aria("department")} />
            <datalist id="departments">
              {lookups.departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field error={err("designation")} name="designation" label="Designation" required>
            <input id="designation" name="designation" type="text" autoComplete="off" defaultValue={value("designation")} {...aria("designation")} />
          </Field>
          <Field error={err("employmentType")} name="employmentType" label="Employment type" required>
            <select id="employmentType" name="employmentType" defaultValue={value("employmentType")} {...aria("employmentType")}>
              <option value="">Choose a type</option>
              {TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field error={err("managerId")} name="managerId" label="Reporting manager" hint="Leave empty if this person reports to nobody.">
            <select id="managerId" name="managerId" defaultValue={value("managerId")} {...aria("managerId")}>
              <option value="">No manager</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName.replace(/^TEST\s+/, "")} ({m.code})
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add employee" : "Save change"}
        </button>
        <Link className="btn btn-secondary btn-small" href={cancelHref}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
