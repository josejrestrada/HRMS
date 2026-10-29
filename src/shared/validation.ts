import { z } from "zod";

/** A real calendar date as YYYY-MM-DD. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine(
    (v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v),
    "Enter a valid date",
  );

/** Blank form fields arrive as empty strings; treat them as missing. */
export function blankToUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === "string" && value.trim() === "" ? undefined : value;
  }
  return out;
}

/** The text fields of a submitted form (Next.js adds internal `$ACTION` keys, which are skipped). */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}
