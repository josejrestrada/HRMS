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
const punchMock = vi.fn();
const requestMock = vi.fn();
const cancelMock = vi.fn();
const decideMock = vi.fn();
const lockMock = vi.fn();
vi.mock("@/modules/attendance/data", () => ({
  punch: (...a: unknown[]) => punchMock(...a),
  requestRegularizations: (...a: unknown[]) => requestMock(...a),
  cancelRegularization: (...a: unknown[]) => cancelMock(...a),
  decideRegularizations: (...a: unknown[]) => decideMock(...a),
  lockMonth: (...a: unknown[]) => lockMock(...a),
}));

import { cancelRegularizationAction, decideRegularizationAction, lockMonthAction, punchAction, requestRegularizationAction } from "@/app/(clerk)/app/attendance/actions";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "e", employeeCode: "KCF0002", fullName: "E", roles: ["employee"] };

beforeEach(() => {
  [actorMock, punchMock, requestMock, cancelMock, decideMock, lockMock].forEach((m) => m.mockReset());
});

describe("punchAction", () => {
  it("refuses someone who is not signed in or not linked, without punching", async () => {
    actorMock.mockResolvedValue(null);
    await expect(punchAction()).rejects.toBeInstanceOf(ForbiddenError);
    expect(punchMock).not.toHaveBeenCalled();
  });

  it("shows a domain error as a message", async () => {
    actorMock.mockResolvedValue(employee);
    punchMock.mockRejectedValue(new DomainError("You just checked in. Please wait a minute before pressing again."));
    await expect(punchAction()).rejects.toThrow(/REDIRECT:\/app\/attendance\?error=You\+just\+checked\+in/);
  });

  it("does not hide unexpected errors", async () => {
    actorMock.mockResolvedValue(employee);
    punchMock.mockRejectedValue(new Error("database down"));
    await expect(punchAction()).rejects.toThrow("database down");
  });

  it("redirects with what was recorded", async () => {
    actorMock.mockResolvedValue(employee);
    punchMock.mockResolvedValue({ direction: "out", time: "17:45" });
    await expect(punchAction()).rejects.toThrow("REDIRECT:/app/attendance?saved=out&time=17%3A45");
  });
});

const hr: Actor = { employeeId: "h", employeeCode: "KCF0001", fullName: "HR", roles: ["employee", "hr_admin"] };
const id1 = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f01";
const id2 = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f02";

function fixForm(days: string[], extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const d of days) {
    f.append("days", d);
    f.set(`in_${d}`, "09:30");
    f.set(`out_${d}`, "17:30");
  }
  f.set("reason", "Forgot to check out");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

describe("requestRegularizationAction", () => {
  it("refuses someone who is not signed in or linked, without saving", async () => {
    actorMock.mockResolvedValue(null);
    await expect(requestRegularizationAction({}, fixForm(["2026-10-05"]))).rejects.toBeInstanceOf(ForbiddenError);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("needs at least one ticked day and a reason, in plain words", async () => {
    actorMock.mockResolvedValue(employee);
    expect((await requestRegularizationAction({}, fixForm([]))).error).toBe("Tick at least one day to fix.");
    const noReason = await requestRegularizationAction({}, fixForm(["2026-10-05"], { reason: "" }));
    expect(noReason.error).toBe("Please give a short reason.");
    expect(noReason.values?.days).toBe("2026-10-05");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("sends every ticked day with its own times and the shared reason", async () => {
    actorMock.mockResolvedValue(employee);
    requestMock.mockResolvedValue({ batchId: "b", count: 2 });
    await expect(requestRegularizationAction({}, fixForm(["2026-10-05", "2026-10-06"]))).rejects.toThrow("REDIRECT:/app/attendance?saved=fix&count=2");
    expect(requestMock.mock.calls[0][1]).toEqual({
      reason: "Forgot to check out",
      items: [
        { date: "2026-10-05", in: "09:30", out: "17:30" },
        { date: "2026-10-06", in: "09:30", out: "17:30" },
      ],
    });
  });

  it("returns a domain error with the ticked days kept, and does not hide unexpected errors", async () => {
    actorMock.mockResolvedValue(employee);
    requestMock.mockRejectedValueOnce(new DomainError("5 Oct 2026: Check-out must be after check-in."));
    const state = await requestRegularizationAction({}, fixForm(["2026-10-05", "2026-10-06"]));
    expect(state.error).toContain("Check-out must be after");
    expect(state.values?.days).toBe("2026-10-05,2026-10-06");
    requestMock.mockRejectedValueOnce(new Error("database down"));
    await expect(requestRegularizationAction({}, fixForm(["2026-10-05"]))).rejects.toThrow("database down");
  });
});

describe("decide and cancel actions", () => {
  const decideForm = (ids: string[], decision: string, note = "") => {
    const f = new FormData();
    for (const i of ids) f.append("requestId", i);
    f.set("decision", decision);
    f.set("note", note);
    return f;
  };

  it("approves a whole batch in one go", async () => {
    actorMock.mockResolvedValue(hr);
    decideMock.mockResolvedValue({ count: 2 });
    await expect(decideRegularizationAction(decideForm([id1, id2], "approve"))).rejects.toThrow("REDIRECT:/app/attendance/approvals?saved=approved&count=2");
    expect(decideMock.mock.calls[0][1]).toMatchObject({ requestIds: [id1, id2], decision: "approve" });
  });

  it("needs a reason to reject, and never calls the data layer without one", async () => {
    actorMock.mockResolvedValue(hr);
    await expect(decideRegularizationAction(decideForm([id1], "reject"))).rejects.toThrow(/error=Please\+give\+a\+short\+reason/);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("shows a refusal as a message", async () => {
    actorMock.mockResolvedValue(hr);
    decideMock.mockRejectedValue(new ForbiddenError("You cannot decide this request."));
    await expect(decideRegularizationAction(decideForm([id1], "approve"))).rejects.toThrow(/error=You\+cannot\+decide/);
  });

  it("refuses the signed-out for both actions", async () => {
    actorMock.mockResolvedValue(null);
    await expect(decideRegularizationAction(decideForm([id1], "approve"))).rejects.toBeInstanceOf(ForbiddenError);
    const f = new FormData();
    f.set("requestId", id1);
    await expect(cancelRegularizationAction(f)).rejects.toBeInstanceOf(ForbiddenError);
    expect(decideMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("cancels and redirects", async () => {
    actorMock.mockResolvedValue(employee);
    cancelMock.mockResolvedValue(undefined);
    const f = new FormData();
    f.set("requestId", id1);
    await expect(cancelRegularizationAction(f)).rejects.toThrow("REDIRECT:/app/attendance?saved=fixcancelled");
  });
});

describe("lockMonthAction", () => {
  const lockForm = (year: string, month: string) => {
    const f = new FormData();
    f.set("year", year);
    f.set("month", month);
    return f;
  };

  it("is refused for anyone who is not an HR admin, without locking", async () => {
    for (const actor of [null, employee]) {
      actorMock.mockResolvedValue(actor);
      await expect(lockMonthAction(lockForm("2026", "9"))).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("needs a real month", async () => {
    actorMock.mockResolvedValue(hr);
    await expect(lockMonthAction(lockForm("2026", "x"))).rejects.toThrow(/error=Choose\+a\+month/);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("shows a domain error on the lock page, and redirects with the totals on success", async () => {
    actorMock.mockResolvedValue(hr);
    lockMock.mockRejectedValueOnce(new DomainError("2 fixes are still waiting for approval."));
    await expect(lockMonthAction(lockForm("2026", "9"))).rejects.toThrow(/REDIRECT:\/app\/attendance\/lock\?year=2026&month=9&error=2\+fixes/);
    lockMock.mockResolvedValueOnce({ year: 2026, month: 9, employees: 23, days: 690, unpaidDays: 4 });
    await expect(lockMonthAction(lockForm("2026", "9"))).rejects.toThrow(/saved=locked&month=9&people=23&unpaid=4/);
  });
});
