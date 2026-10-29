import { z } from "zod";
import { addDays, todayIST } from "@/shared/dates";
import { blankToUndefined, isoDate } from "@/shared/validation";

export const EMPLOYMENT_TYPES = ["permanent", "probation", "contract", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAGE_SIZE = 20;

const text = (label: string, max = 80) =>
  z.string({ error: `Enter the ${label}` }).trim().min(1, `Enter the ${label}`).max(max, `The ${label} is too long`);

export { blankToUndefined };

const assignmentFields = {
  locationId: z.uuid("Choose a location"),
  department: text("department"),
  designation: text("designation"),
  employmentType: z.enum(EMPLOYMENT_TYPES, { error: "Choose an employment type" }),
  managerId: z.uuid("Choose a valid manager").optional(),
};

export const newEmployeeSchema = z
  .object({
    fullName: z.string({ error: "Enter the full name" }).trim().min(2, "Enter the full name").max(120, "The name is too long"),
    workEmail: z
      .string({ error: "Enter the work email" })
      .trim()
      .toLowerCase()
      .max(200, "The email is too long")
      .pipe(z.email("Enter a valid email address")),
    gender: z.enum(["female", "male", "other"]).optional(),
    dateOfBirth: isoDate.optional(),
    joiningDate: isoDate,
    ...assignmentFields,
  })
  .superRefine((v, ctx) => {
    const latest = addDays(todayIST(), 365);
    if (v.joiningDate < "2000-01-01" || v.joiningDate > latest) {
      ctx.addIssue({ code: "custom", path: ["joiningDate"], message: "The joining date looks wrong. Check the year." });
    }
    if (v.dateOfBirth) {
      const fourteenth = `${Number(v.dateOfBirth.slice(0, 4)) + 14}${v.dateOfBirth.slice(4)}`;
      if (fourteenth > v.joiningDate) {
        ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "The employee must be at least 14 on the joining date." });
      }
    }
  });
export type NewEmployeeInput = z.infer<typeof newEmployeeSchema>;

export const changeAssignmentSchema = z.object({
  effectiveFrom: isoDate,
  ...assignmentFields,
});
export type ChangeAssignmentInput = z.infer<typeof changeAssignmentSchema>;

export const deactivateSchema = z.object({ exitDate: isoDate });
export type DeactivateInput = z.infer<typeof deactivateSchema>;

const firstString = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export const listFilterSchema = z.object({
  q: z.preprocess(firstString, z.string().trim().max(80).optional()),
  status: z.preprocess(firstString, z.enum(["active", "inactive", "all"]).catch("active")),
  location: z.preprocess(firstString, z.uuid().optional().catch(undefined)),
  department: z.preprocess(firstString, z.string().trim().max(80).optional()),
  page: z.preprocess(firstString, z.coerce.number().int().min(1).max(1000).catch(1)),
});
export type ListFilter = z.infer<typeof listFilterSchema>;
