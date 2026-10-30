import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getDraftMock = vi.fn();
const markUsedMock = vi.fn();
vi.mock("@/modules/agent/data", () => ({
  getUsableDraft: (...a: unknown[]) => getDraftMock(...a),
  markDraftUsed: (...a: unknown[]) => markUsedMock(...a),
}));
const applyMock = vi.fn();
vi.mock("@/modules/leave/data", () => ({ applyLeave: (...a: unknown[]) => applyMock(...a) }));
const auditMock = vi.fn();
vi.mock("@/shared/audit", () => ({ recordAudit: (...a: unknown[]) => auditMock(...a) }));

import { confirmLeaveDraft } from "@/modules/agent/service";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";

const me: Actor = { employeeId: "e1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const typeId = "7b0c8c52-3a52-4d7c-9d2e-0f6f3f3f3f3f";
const goodDraft = {
  id: "d1", conversationId: "c1", kind: "leave_application",
  payload: { input: { leaveTypeId: typeId, startDate: "2026-11-03", endDate: "2026-11-05", dayPart: "full", reason: "family", convertShortfallToLop: false } },
  expiresAt: "", consumedAt: null,
};

beforeEach(() => [getDraftMock, markUsedMock, applyMock, auditMock].forEach((m) => m.mockReset()));

describe("confirmLeaveDraft", () => {
  it("applies the saved fields through the normal leave application, then marks the draft used and audits it", async () => {
    getDraftMock.mockResolvedValue(goodDraft);
    applyMock.mockResolvedValue({ requestId: "r1" });
    expect(await confirmLeaveDraft(me, "d1")).toEqual({ ok: true });
    expect(applyMock).toHaveBeenCalledWith(me, { leaveTypeId: typeId, startDate: "2026-11-03", endDate: "2026-11-05", dayPart: "full", reason: "family", convertShortfallToLop: false });
    expect(markUsedMock).toHaveBeenCalledWith(me, "d1");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_leave_confirmed", entityId: "d1" }));
  });

  it("refuses a draft that is missing, expired, used or someone else's, and applies nothing", async () => {
    getDraftMock.mockResolvedValue(null); // the lookup only returns this person's unused, unexpired drafts
    const r = await confirmLeaveDraft(me, "d9");
    expect(r.ok).toBe(false);
    expect(applyMock).not.toHaveBeenCalled();
    expect(markUsedMock).not.toHaveBeenCalled();
    expect(getDraftMock).toHaveBeenCalledWith(me, "d9");
  });

  it("shows the leave rules' own message if the application is refused, and keeps the draft unused", async () => {
    getDraftMock.mockResolvedValue(goodDraft);
    applyMock.mockRejectedValue(new DomainError("You already have leave that overlaps these dates."));
    expect(await confirmLeaveDraft(me, "d1")).toEqual({ ok: false, error: "You already have leave that overlaps these dates." });
    expect(markUsedMock).not.toHaveBeenCalled();
  });

  it("does not trust a damaged draft: it is validated again", async () => {
    getDraftMock.mockResolvedValue({ ...goodDraft, payload: { input: { leaveTypeId: "not-a-uuid", startDate: "2026-02-31", endDate: "x", dayPart: "full" } } });
    expect((await confirmLeaveDraft(me, "d1")).ok).toBe(false);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("does not hide unexpected errors, and refuses someone who is not a linked employee", async () => {
    getDraftMock.mockResolvedValue(goodDraft);
    applyMock.mockRejectedValue(new Error("database down"));
    await expect(confirmLeaveDraft(me, "d1")).rejects.toThrow("database down");
    await expect(confirmLeaveDraft(null, "d1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
