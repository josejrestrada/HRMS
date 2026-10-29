import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const queryMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/shared/db", () => ({
  query: (...a: unknown[]) => queryMock(...a),
  transaction: (...a: unknown[]) => transactionMock(...a),
}));

import * as people from "@/modules/employees/data";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const id = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";
const filter = { status: "active" as const, page: 1 };
const newInput = {
  fullName: "X Y",
  workEmail: "x@example.invalid",
  joiningDate: "2026-10-01",
  locationId: id,
  department: "D",
  designation: "E",
  employmentType: "permanent" as const,
};
const change = { effectiveFrom: "2026-11-01", locationId: id, department: "D", designation: "E", employmentType: "permanent" as const };

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
});

const calls: [string, (a: Actor | null) => Promise<unknown>][] = [
  ["getPeopleLookups", (a) => people.getPeopleLookups(a)],
  ["listEmployees", (a) => people.listEmployees(a, filter)],
  ["getEmployeeProfile", (a) => people.getEmployeeProfile(a, id)],
  ["createEmployee", (a) => people.createEmployee(a, newInput)],
  ["changeAssignment", (a) => people.changeAssignment(a, id, change)],
  ["deactivateEmployee", (a) => people.deactivateEmployee(a, id, { exitDate: "2026-10-30" })],
  ["reactivateEmployee", (a) => people.reactivateEmployee(a, id)],
];

describe.each(calls)("%s", (_name, run) => {
  it("rejects a missing actor without touching the database", async () => {
    await expect(run(null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects an ordinary employee without touching the database", async () => {
    await expect(run(employee)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("transaction-level functions also check the role", () => {
  const tx = { query: vi.fn() };
  it.each([
    ["createEmployeeTx", () => people.createEmployeeTx(tx, employee, newInput)],
    ["changeAssignmentTx", () => people.changeAssignmentTx(tx, employee, id, change)],
    ["deactivateEmployeeTx", () => people.deactivateEmployeeTx(tx, employee, id, { exitDate: "2026-10-30" })],
    ["reactivateEmployeeTx", () => people.reactivateEmployeeTx(tx, employee, id)],
  ])("%s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
  });
});
