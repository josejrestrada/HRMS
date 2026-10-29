import { describe, expect, it } from "vitest";
import { blankToUndefined, changeAssignmentSchema, listFilterSchema, newEmployeeSchema } from "@/modules/employees/schemas";

const loc = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";
const valid = {
  fullName: "Asha Naik",
  workEmail: "  Asha.Naik@Example.INVALID ",
  joiningDate: "2026-10-01",
  locationId: loc,
  department: "Finance",
  designation: "Accounts Executive",
  employmentType: "permanent",
};

describe("newEmployeeSchema", () => {
  it("accepts a valid employee and normalises the email", () => {
    const r = newEmployeeSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.workEmail).toBe("asha.naik@example.invalid");
  });

  it("rejects a bad email with a plain message", () => {
    const r = newEmployeeSchema.safeParse({ ...valid, workEmail: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Enter a valid email address");
  });

  it("rejects an impossible date", () => {
    expect(newEmployeeSchema.safeParse({ ...valid, joiningDate: "2026-02-30" }).success).toBe(false);
  });

  it("rejects a joining date with a silly year", () => {
    expect(newEmployeeSchema.safeParse({ ...valid, joiningDate: "1990-01-01" }).success).toBe(false);
  });

  it("requires the employee to be at least 14 on the joining date", () => {
    expect(newEmployeeSchema.safeParse({ ...valid, dateOfBirth: "2015-01-01" }).success).toBe(false);
    expect(newEmployeeSchema.safeParse({ ...valid, dateOfBirth: "2000-01-01" }).success).toBe(true);
  });

  it("requires a location id and a known employment type", () => {
    expect(newEmployeeSchema.safeParse({ ...valid, locationId: "nope" }).success).toBe(false);
    expect(newEmployeeSchema.safeParse({ ...valid, employmentType: "boss" }).success).toBe(false);
  });

  it("treats a blank manager as no manager", () => {
    const r = newEmployeeSchema.safeParse(blankToUndefined({ ...valid, managerId: "", gender: "", dateOfBirth: "" }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.managerId).toBeUndefined();
  });
});

describe("changeAssignmentSchema", () => {
  it("needs an effective date and job details", () => {
    expect(changeAssignmentSchema.safeParse({ effectiveFrom: "2026-11-01", locationId: loc, department: "A", designation: "B", employmentType: "contract" }).success).toBe(true);
    expect(changeAssignmentSchema.safeParse({ locationId: loc, department: "A", designation: "B", employmentType: "contract" }).success).toBe(false);
  });
});

describe("listFilterSchema", () => {
  it("falls back to safe defaults for junk input", () => {
    const f = listFilterSchema.parse({ status: "everything", page: "-4", location: "not-a-uuid" });
    expect(f.status).toBe("active");
    expect(f.page).toBe(1);
    expect(f.location).toBeUndefined();
  });

  it("takes the first value when a parameter is repeated and trims the search", () => {
    const f = listFilterSchema.parse({ q: ["  asha  ", "other"], page: ["3"] });
    expect(f.q).toBe("asha");
    expect(f.page).toBe(3);
  });
});
