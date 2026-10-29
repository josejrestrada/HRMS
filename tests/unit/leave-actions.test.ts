import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
const actorMock = vi.fn();
vi.mock("@/shared/auth", () => ({ getCurrentActor: () => actorMock() }));
const applyMock = vi.fn();
const cancelMock = vi.fn();
const decideMock = vi.fn();
const creditsMock = vi.fn();
const yearEndMock = vi.fn();
vi.mock("@/modules/leave/data", () => ({
  applyLeave: (...a: unknown[]) => applyMock(...a),
  cancelLeave: (...a: unknown[]) => cancelMock(...a),
  decideLeave: (...a: unknown[]) => decideMock(...a),
  runLeaveCredits: (...a: unknown[]) => creditsMock(...a),
  runYearEnd: (...a: unknown[]) => yearEndMock(...a),
}));

import { applyLeaveAction, cancelLeaveAction, decideLeaveAction, runLeaveCreditsAction, runYearEndAction } from "@/app/(clerk)/app/leave/actions";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "e", employeeCode: "KCF0002", fullName: "E", roles: ["employee"] };
const hr: Actor = { employeeId: "hr", employeeCode: "KCF0001", fullName: "HR", roles: ["employee", "hr_admin"] };
const id = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
const goodApply = { leaveTypeId: id, startDate: "2026-11-02", endDate: "2026-11-03", dayPart: "full", reason: "" };

beforeEach(() => {
  [actorMock, applyMock, cancelMock, decideMock, creditsMock, yearEndMock].forEach((m) => m.mockReset());
});

describe("leave actions need a signed-in, linked employee", () => {
  it.each([
    ["apply", () => applyLeaveAction({}, form(goodApply))],
    ["cancel", () => cancelLeaveAction(form({ requestId: id }))],
    ["decide", () => decideLeaveAction(form({ requestId: id, decision: "approve" }))],
    ["credits", () => runLeaveCreditsAction(form({ year: "2026" }))],
    ["year-end", () => runYearEndAction(form({ year: "2026" }))],
  ])("%s", async (_n, run) => {
    actorMock.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    expect(applyMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
    expect(decideMock).not.toHaveBeenCalled();
    expect(creditsMock).not.toHaveBeenCalled();
    expect(yearEndMock).not.toHaveBeenCalled();
  });

  it("running credits or year-end is refused for an ordinary employee", async () => {
    actorMock.mockResolvedValue(employee);
    await expect(runLeaveCreditsAction(form({ year: "2026" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runYearEndAction(form({ year: "2026" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(creditsMock).not.toHaveBeenCalled();
    expect(yearEndMock).not.toHaveBeenCalled();
  });
});

describe("applyLeaveAction", () => {
  it("returns a plain message and keeps the typed values when a field is wrong", async () => {
    actorMock.mockResolvedValue(employee);
    const state = await applyLeaveAction({}, form({ ...goodApply, startDate: "2026-02-30" }));
    expect(state.field).toBe("startDate");
    expect(state.values?.endDate).toBe("2026-11-03");
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("passes the checkbox through as a boolean", async () => {
    actorMock.mockResolvedValue(employee);
    applyMock.mockResolvedValue({ requestId: id });
    await expect(applyLeaveAction({}, form({ ...goodApply, convertShortfallToLop: "on" }))).rejects.toThrow("REDIRECT:/app/leave?saved=applied");
    expect(applyMock.mock.calls[0][1].convertShortfallToLop).toBe(true);
  });

  it("returns a domain error to the form and does not hide unexpected errors", async () => {
    actorMock.mockResolvedValue(employee);
    applyMock.mockRejectedValueOnce(new DomainError("You already have leave that overlaps.", "startDate"));
    expect((await applyLeaveAction({}, form(goodApply))).field).toBe("startDate");
    applyMock.mockRejectedValueOnce(new Error("database down"));
    await expect(applyLeaveAction({}, form(goodApply))).rejects.toThrow("database down");
  });
});

describe("decideLeaveAction", () => {
  it("needs a reason to reject, and never calls the data layer without one", async () => {
    actorMock.mockResolvedValue(hr);
    await expect(decideLeaveAction(form({ requestId: id, decision: "reject", note: "" }))).rejects.toThrow(/REDIRECT:\/app\/leave\/approvals\?error=Please\+give/);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("shows a refusal from the data layer as a message, not a crash", async () => {
    actorMock.mockResolvedValue(hr);
    decideMock.mockRejectedValue(new ForbiddenError("You cannot decide this request."));
    await expect(decideLeaveAction(form({ requestId: id, decision: "approve" }))).rejects.toThrow(/error=You\+cannot\+decide/);
  });

  it("redirects with a saved message on success", async () => {
    actorMock.mockResolvedValue(hr);
    decideMock.mockResolvedValue(undefined);
    await expect(decideLeaveAction(form({ requestId: id, decision: "approve" }))).rejects.toThrow("REDIRECT:/app/leave/approvals?saved=approved");
  });
});

describe("runYearEndAction", () => {
  it("shows a domain error from the data layer as a message", async () => {
    actorMock.mockResolvedValue(hr);
    yearEndMock.mockRejectedValue(new DomainError("Year-end can only be run from 31 December 2026."));
    await expect(runYearEndAction(form({ year: "2026" }))).rejects.toThrow(/REDIRECT:\/app\/leave\/admin\?error=Year-end/);
  });

  it("redirects with a summary on success", async () => {
    actorMock.mockResolvedValue(hr);
    yearEndMock.mockResolvedValue({ year: 2026, applied: true, canRun: true, employees: 2, lines: [{ code: "EL", name: "Earned leave", people: 2, lapsed: 0, encashed: 3, carried: 90 }] });
    await expect(runYearEndAction(form({ year: "2026" }))).rejects.toThrow(/saved=yearend.*lines=EL%3A0%3A3%3A90/);
  });

  it("refuses a non-numeric year without calling the data layer", async () => {
    actorMock.mockResolvedValue(hr);
    await expect(runYearEndAction(form({ year: "soon" }))).rejects.toThrow(/error=Choose\+a\+year/);
    expect(yearEndMock).not.toHaveBeenCalled();
  });
});
