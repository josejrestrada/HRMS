import { describe, expect, it } from "vitest";
import { ForbiddenError, requireRole, type Actor } from "../../src/shared/roles";

const employee: Actor = { employeeId: "1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const hr: Actor = { employeeId: "2", employeeCode: "KCF0002", fullName: "B", roles: ["employee", "hr_admin"] };

describe("requireRole", () => {
  it("rejects a missing actor", () => {
    expect(() => requireRole(null, "hr_admin")).toThrow(ForbiddenError);
    expect(() => requireRole(undefined, "hr_admin")).toThrow(ForbiddenError);
  });

  it("rejects an actor without the role", () => {
    expect(() => requireRole(employee, "hr_admin")).toThrow(ForbiddenError);
  });

  it("allows an actor with the role", () => {
    expect(() => requireRole(hr, "hr_admin")).not.toThrow();
  });

  it("allows any one of several roles", () => {
    expect(() => requireRole(hr, "system_admin", "hr_admin")).not.toThrow();
  });
});
