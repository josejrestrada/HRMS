import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const queryMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/shared/db", () => ({
  query: (...a: unknown[]) => queryMock(...a),
  transaction: (...a: unknown[]) => transactionMock(...a),
}));

import * as leave from "@/modules/leave/data";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const id = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";
const apply = { leaveTypeId: id, startDate: "2026-11-02", endDate: "2026-11-02", dayPart: "full" as const, convertShortfallToLop: false };

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
});

describe("every leave function refuses a missing actor without touching the database", () => {
  it.each([
    ["getLeaveOverview", () => leave.getLeaveOverview(null)],
    ["getApplyContext", () => leave.getApplyContext(null)],
    ["getStatement", () => leave.getStatement(null, "CL")],
    ["listApprovals", () => leave.listApprovals(null)],
    ["getApprovalScope", () => leave.getApprovalScope(null)],
    ["applyLeave", () => leave.applyLeave(null, apply)],
    ["cancelLeave", () => leave.cancelLeave(null, id)],
    ["decideLeave", () => leave.decideLeave(null, { requestId: id, decision: "approve" })],
    ["runLeaveCredits", () => leave.runLeaveCredits(null)],
    ["previewYearEnd", () => leave.previewYearEnd(null, 2026)],
    ["runYearEnd", () => leave.runYearEnd(null, { year: 2026 })],
    ["getLeaveEligibility", () => leave.getLeaveEligibility(null)],
    ["applyMaternity", () => leave.applyMaternity(null, { startDate: "2026-12-01", expectedDeliveryDate: "2027-01-10", survivingChildren: 0 })],
    ["applyPaternity", () => leave.applyPaternity(null, { birthDate: "2026-10-25", startDate: "2026-11-02", endDate: "2026-11-06" })],
    ["getMyCompoff", () => leave.getMyCompoff(null)],
    ["requestCompoff", () => leave.requestCompoff(null, { workedDate: "2026-10-24", part: "full" })],
    ["cancelCompoff", () => leave.cancelCompoff(null, id)],
    ["decideCompoff", () => leave.decideCompoff(null, { requestId: id, decision: "approve" })],
    ["listCompoffApprovals", () => leave.listCompoffApprovals(null)],
    ["runCompoffExpiry", () => leave.runCompoffExpiry(null)],
  ])("%s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("year-end is for HR admins only", () => {
  it("rejects an ordinary employee before any query", async () => {
    await expect(leave.previewYearEnd(employee, 2026)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(leave.runYearEnd(employee, { year: 2026 })).rejects.toBeInstanceOf(ForbiddenError);
    const tx = { query: vi.fn() };
    await expect(leave.runYearEndTx(tx, employee, { year: 2026 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("expiring comp-off is for HR admins only", () => {
  it("rejects an ordinary employee before any query", async () => {
    await expect(leave.runCompoffExpiry(employee)).rejects.toBeInstanceOf(ForbiddenError);
    const tx = { query: vi.fn() };
    await expect(leave.runCompoffExpiryTx(tx, employee)).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("running leave credits is for HR admins only", () => {
  it("rejects an ordinary employee before any query", async () => {
    await expect(leave.runLeaveCredits(employee)).rejects.toBeInstanceOf(ForbiddenError);
    const tx = { query: vi.fn() };
    await expect(leave.runLeaveCreditsTx(tx, employee)).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("transaction-level functions also check the actor", () => {
  const tx = { query: vi.fn() };
  it.each([
    ["applyLeaveTx", () => leave.applyLeaveTx(tx, null, apply)],
    ["decideLeaveTx", () => leave.decideLeaveTx(tx, null, { requestId: id, decision: "approve" })],
    ["cancelLeaveTx", () => leave.cancelLeaveTx(tx, null, id)],
    ["applyMaternityTx", () => leave.applyMaternityTx(tx, null, { startDate: "2026-12-01", expectedDeliveryDate: "2027-01-10", survivingChildren: 0 })],
    ["applyPaternityTx", () => leave.applyPaternityTx(tx, null, { birthDate: "2026-10-25", startDate: "2026-11-02", endDate: "2026-11-06" })],
    ["requestCompoffTx", () => leave.requestCompoffTx(tx, null, { workedDate: "2026-10-24", part: "full" })],
    ["cancelCompoffTx", () => leave.cancelCompoffTx(tx, null, id)],
    ["decideCompoffTx", () => leave.decideCompoffTx(tx, null, { requestId: id, decision: "approve" })],
  ])("%s", async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.query).not.toHaveBeenCalled();
  });
});
