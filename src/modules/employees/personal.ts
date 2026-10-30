import { z } from "zod";

// Pure rules for PAN and Aadhaar (decision P7). No database, no secrets.

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Trim and upper-case what the person typed, so "abcde1234f " is accepted. */
export const normalizePan = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/** ABCDE1234F becomes ABCDE••••F. Safe to show and to store. */
export function maskPan(pan: string): string {
  return `${pan.slice(0, 5)}••••${pan.slice(-1)}`;
}

/** Only the last 4 digits are ever kept: XXXX XXXX 1234. */
export const maskAadhaar = (last4: string) => `XXXX XXXX ${last4}`;

export const personalDetailsSchema = z.object({
  // Empty means "leave as it is" (the form never shows the stored value back).
  pan: z
    .string()
    .transform(normalizePan)
    .refine((v) => v === "" || PAN_PATTERN.test(v), "Enter the PAN as 5 letters, 4 digits and 1 letter, for example ABCDE1234F")
    .optional(),
  aadhaarLast4: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[0-9]{4}$/.test(v), "Enter only the last 4 digits of the Aadhaar number")
    .optional(),
});
export type PersonalDetailsInput = z.infer<typeof personalDetailsSchema>;

export type PersonalDetails = {
  employeeId: string;
  panMasked: string | null;
  aadhaarMasked: string | null;
  aadhaarVerified: boolean;
  updatedAt: string | null;
};

/** At most this many reveals per HR user per hour. */
export const REVEAL_LIMIT_PER_HOUR = 10;
