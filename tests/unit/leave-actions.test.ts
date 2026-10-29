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
const maternityMock = vi.fn();
const paternityMock = vi.fn();
const compoffRequestMock = vi.fn();
const compoffCancelMock = vi.fn();
const compoffDecideMock = vi.fn();
const compoffExpiryMock = vi.fn();
vi.mock("@/modules/leave/data", () => ({
  applyLeave: (...a: unknown[]) => applyMock(...a),
  cancelLeave: (...a: unknown[]) => cancelMock(...a),
  decideLeave: (...a: unknown[]) => decideMock(...a),
  runLeaveCredits: (...a: unknown[]) => creditsMock(...a),
  runYearEnd: (...a: unknown[]) => yearEndMock(...a),
  applyMaternity: (...a: unknown[]) => maternityMock(...a),
  applyPaternity: (...a: unknown[]) => paternityMock(...a),
  requestCompoff: (...a: unknown[]) => compoffRequestMock(...a),
  cancelCompoff: (...a: unknown[]) => compoffCancelMock(...a),
  decideCompoff: (...a: unknown[]) => compoffDecideMock(...a),
  runCompoffExpiry: (...a: unknown[]) => compoffExpiryMock(...a),
}));

import {
  applyLeaveAction,
  applyMaternityAction,
  applyPaternityAction,
  cancelCompoffAction,
  cancelLeaveAction,
  decideCompoffAction,
  decideLeaveAction,
  requestCompoffAction,
  runCompoffExpiryAction,
  runLeaveCreditsAction,
  runYearEndAction,
} from "@/app/(clerk)/app/leave/actions";
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
  [actorMock, applyMock, cancelMock, decideMock, creditsMock, yearEndMock, maternityMock, paternityMock, compoffRequestMock, compoffCancelMock, compoffDecideMock, compoffExpiryMock].forEach((m) => m.mockReset());
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

const goodMaternity = { startDate: "2026-12-01", expectedDeliveryDate: "2027-01-10", survivingChildren: "0", reason: "" };
const goodPaternity = { birthDate: "2026-10-25", startDate: "2026-11-02", endDate: "2026-11-06" };
const goodCompoff = { workedDate: "2026-10-24", part: "full", reason: "" };

describe("family leave and comp-off actions need a signed-in, linked employee", () => {
  it.each([
    ["maternity", () => applyMaternityAction({}, form(goodMaternity))],
    ["paternity", () => applyPaternityAction({}, form(goodPaternity))],
    ["request comp-off", () => requestCompoffAction({}, form(goodCompoff))],
    ["cancel comp-off", () => cancelCompoffAction(form({ requestId: id }))],
    ["decide comp-off", () => decideCompoffAction(form({ requestId: id, decision: "approve" }))],
    ["expire comp-off", () => runCompoffExpiryAction()],
  ])("%s", async (_n, run) => {
    actorMock.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(ForbiddenError);
    for (const m of [maternityMock, paternityMock, compoffRequestMock, compoffCancelMock, compoffDecideMock, compoffExpiryMock]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it("expiring comp-off is refused for an ordinary employee", async () => {
    actorMock.mockResolvedValue(employee);
    await expect(runCompoffExpiryAction()).rejects.toBeInstanceOf(ForbiddenError);
    expect(compoffExpiryMock).not.toHaveBeenCalled();
  });
});

describe("applyMaternityAction", () => {
  it("asks for the number of children in plain words and keeps what was typed", async () => {
    actorMock.mockResolvedValue(employee);
    const state = await applyMaternityAction({}, form({ ...goodMaternity, survivingChildren: "" }));
    expect(state.field).toBe("survivingChildren");
    expect(state.error).toContain("surviving children");
    expect(state.values?.startDate).toBe("2026-12-01");
    expect(maternityMock).not.toHaveBeenCalled();
  });

  it("returns a domain error to the form, and redirects on success", async () => {
    actorMock.mockResolvedValue(employee);
    maternityMock.mockRejectedValueOnce(new DomainError("Maternity leave must start on or before the expected delivery date.", "startDate"));
    expect((await applyMaternityAction({}, form(goodMaternity))).field).toBe("startDate");
    maternityMock.mockResolvedValueOnce({ requestId: id, endDate: "2027-05-31" });
    await expect(applyMaternityAction({}, form(goodMaternity))).rejects.toThrow("REDIRECT:/app/leave?saved=applied");
    expect(maternityMock.mock.calls[1][1].survivingChildren).toBe(0);
  });
});

describe("applyPaternityAction and comp-off actions", () => {
  it("validates dates before calling the data layer", async () => {
    actorMock.mockResolvedValue(employee);
    const state = await applyPaternityAction({}, form({ ...goodPaternity, birthDate: "2026-13-40" }));
    expect(state.field).toBe("birthDate");
    expect(paternityMock).not.toHaveBeenCalled();
  });

  it("requires full or half for comp-off and redirects on success", async () => {
    actorMock.mockResolvedValue(employee);
    expect((await requestCompoffAction({}, form({ ...goodCompoff, part: "" }))).field).toBe("part");
    compoffRequestMock.mockResolvedValue({ requestId: id });
    await expect(requestCompoffAction({}, form(goodCompoff))).rejects.toThrow("REDIRECT:/app/leave/comp-off?saved=requested");
  });

  it("shows a refusal when deciding comp-off as a message", async () => {
    actorMock.mockResolvedValue(hr);
    compoffDecideMock.mockRejectedValue(new ForbiddenError("You cannot decide this request."));
    await expect(decideCompoffAction(form({ requestId: id, decision: "approve" }))).rejects.toThrow(/REDIRECT:\/app\/leave\/approvals\?error=You\+cannot\+decide/);
  });

  it("expires comp-off and redirects with the totals", async () => {
    actorMock.mockResolvedValue(hr);
    compoffExpiryMock.mockResolvedValue({ credits: 2, days: 1.5 });
    await expect(runCompoffExpiryAction()).rejects.toThrow(/saved=compoff&credits=2&days=1.5/);
  });
});
