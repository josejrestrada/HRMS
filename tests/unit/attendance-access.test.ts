import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const queryMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/shared/db", () => ({
  query: (...a: unknown[]) => queryMock(...a),
  transaction: (...a: unknown[]) => transactionMock(...a),
}));

import * as attendance from "@/modules/attendance/data";
import { getWorkforce } from "@/modules/employees/data";
import { getCalendarFacts } from "@/modules/leave/data";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "e1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const hr: Actor = { employeeId: "h1", employeeCode: "KCF0002", fullName: "H", roles: ["employee", "hr_admin"] };

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
  transactionMock.mockReset();
});

describe("attendance functions refuse a missing actor without touching the database", () => {
  it.each([
    ["getMyAttendance", () => attendance.getMyAttendance(null, 2026, 10)],
    ["punch", () => attendance.punch(null)],
    ["getDaySheet", () => attendance.getDaySheet(null, "2026-10-30")],
    ["getDaySummary", () => attendance.getDaySummary(null, "2026-10-30")],
    ["requestRegularizations", () => attendance.requestRegularizations(null, { reason: "forgot", items: [{ date: "2026-10-05", in: "09:30", out: "17:30" }] })],
    ["cancelRegularization", () => attendance.cancelRegularization(null, "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f")],
    ["decideRegularizations", () => attendance.decideRegularizations(null, { requestIds: ["7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f"], decision: "approve" })],
    ["listRegularizationApprovals", () => attendance.listRegularizationApprovals(null)],
    ["getAttendanceApprovalScope", () => attendance.getAttendanceApprovalScope(null)],
    ["getLockOverview", () => attendance.getLockOverview(null, 2026)],
    ["previewMonthLock", () => attendance.previewMonthLock(null, 2026, 9)],
    ["lockMonth", () => attendance.lockMonth(null, { year: 2026, month: 9 })],
  ])("%s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("only HR can read everyone's attendance", () => {
  it("rejects an ordinary employee before any query", async () => {
    await expect(attendance.getDaySheet(employee, "2026-10-30")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attendance.getDaySummary(employee, "2026-10-30")).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows an HR admin", async () => {
    const sheet = await attendance.getDaySheet(hr, "2026-10-30");
    expect(sheet.rows).toEqual([]);
    expect(queryMock).toHaveBeenCalled();
  });
});

describe("cross-module helpers only show an employee their own data", () => {
  it("getWorkforce refuses another employee's id and a request for everyone", async () => {
    await expect(getWorkforce(employee, ["someone-else"], "2026-10-30")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getWorkforce(employee, null, "2026-10-30")).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
    await expect(getWorkforce(employee, ["e1"], "2026-10-30")).resolves.toEqual([]);
  });

  it("getCalendarFacts refuses another employee's id and a request for everyone", async () => {
    const opts = { locationIds: [], from: "2026-10-01", to: "2026-10-31" };
    await expect(getCalendarFacts(employee, { ...opts, employeeIds: ["someone-else"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCalendarFacts(employee, { ...opts, employeeIds: null })).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("lets HR ask about anyone", async () => {
    await expect(getWorkforce(hr, ["someone-else"], "2026-10-30")).resolves.toEqual([]);
    await expect(getCalendarFacts(hr, { locationIds: [], from: "2026-10-01", to: "2026-10-31", employeeIds: null })).resolves.toEqual({ leave: [], holidays: [] });
  });
});

describe("getMyAttendance validates the month", () => {
  it("refuses an impossible month without querying", async () => {
    await expect(attendance.getMyAttendance(employee, 2026, 13)).rejects.toThrow(/valid month/);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("regularization transaction functions also check the actor", () => {
  const tx = { query: vi.fn() };
  it.each([
    ["requestRegularizationsTx", () => attendance.requestRegularizationsTx(tx, null, { reason: "forgot", items: [{ date: "2026-10-05", in: "09:30", out: "17:30" }] })],
    ["cancelRegularizationTx", () => attendance.cancelRegularizationTx(tx, null, "r1")],
    ["decideRegularizationsTx", () => attendance.decideRegularizationsTx(tx, null, { requestIds: ["r1"], decision: "approve" })],
  ])("%s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
  });
});

describe("an ordinary employee with no reports sees no approvals", () => {
  it("lists nothing and cannot approve", async () => {
    // getDirectReportIds finds nobody, so no query for requests is made.
    queryMock.mockResolvedValueOnce([]);
    expect(await attendance.listRegularizationApprovals(employee)).toEqual([]);
    queryMock.mockResolvedValueOnce([]);
    expect(await attendance.getAttendanceApprovalScope(employee)).toEqual({ canApprove: false, pending: 0 });
  });
});

describe("the month lock is for HR admins only", () => {
  it("refuses an ordinary employee before any query", async () => {
    await expect(attendance.getLockOverview(employee, 2026)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attendance.previewMonthLock(employee, 2026, 9)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attendance.lockMonth(employee, { year: 2026, month: 9 })).rejects.toBeInstanceOf(ForbiddenError);
    const tx = { query: vi.fn() };
    await expect(attendance.lockMonthTx(tx, employee, { year: 2026, month: 9 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses an impossible month and a month that has not ended, before locking anything", async () => {
    const tx = { query: vi.fn() };
    await expect(attendance.lockMonthTx(tx, hr, { year: 2026, month: 13 })).rejects.toThrow(/valid month/);
    await expect(attendance.lockMonthTx(tx, hr, { year: 2999, month: 1 })).rejects.toThrow(/valid month/);
    const now = new Date();
    await expect(attendance.lockMonthTx(tx, hr, { year: now.getUTCFullYear() + 1, month: 1 })).rejects.toThrow(/valid month|after it has ended/);
    expect(tx.query).not.toHaveBeenCalled();
  });

  it("only HR can read people for a whole period", async () => {
    await expect(getWorkforce(employee, ["e1"], "2026-09-01", undefined, { from: "2026-09-01", to: "2026-09-30" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
