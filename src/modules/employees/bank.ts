import { z } from "zod";

// Pure rules for bank and salary (decision 2026-10-31). No database, no secrets.

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_PATTERN = /^[0-9]{9,18}$/;
export const UAN_PATTERN = /^[0-9]{12}$/;
export const MAX_MONTHLY_SALARY = 10_000_000;

const compact = (v: string) => v.replace(/[\s-]+/g, "");

/** 123456789012 becomes ••••••••9012. Safe to show and to store. */
export const maskDigits = (digits: string) => `${"•".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;

/** Empty means "leave as it is" (the form never shows stored secrets back). */
export const bankSchema = z.object({
  accountHolder: z.string().trim().max(120, "Name is too long").optional(),
  bankName: z.string().trim().max(120, "Bank name is too long").optional(),
  ifsc: z
    .string()
    .transform((v) => compact(v).toUpperCase())
    .refine((v) => v === "" || IFSC_PATTERN.test(v), "Enter the IFSC as 4 letters, a zero and 6 letters or digits, for example SBIN0001234")
    .optional(),
  account: z
    .string()
    .transform(compact)
    .refine((v) => v === "" || ACCOUNT_PATTERN.test(v), "Enter the account number as 9 to 18 digits")
    .optional(),
  uan: z
    .string()
    .transform(compact)
    .refine((v) => v === "" || UAN_PATTERN.test(v), "Enter the UAN as 12 digits")
    .optional(),
  salary: z
    .string()
    .transform((v) => v.replace(/[,\s]/g, ""))
    .refine((v) => v === "" || (/^[0-9]+$/.test(v) && Number(v) > 0 && Number(v) <= MAX_MONTHLY_SALARY), "Enter the monthly salary in rupees, as a whole number")
    .optional(),
});
export type BankInput = z.infer<typeof bankSchema>;

export type BankDetails = {
  employeeId: string;
  accountHolder: string | null;
  bankName: string | null;
  ifsc: string | null;
  accountMasked: string | null;
  uanMasked: string | null;
  hasSalary: boolean;
  updatedAt: string | null;
};

export const BANK_REVEAL_FIELDS = ["account", "uan", "salary"] as const;
export type BankRevealField = (typeof BANK_REVEAL_FIELDS)[number];

/** At most this many reveals per HR user per hour, across account, UAN and salary. */
export const BANK_REVEAL_LIMIT_PER_HOUR = 10;
