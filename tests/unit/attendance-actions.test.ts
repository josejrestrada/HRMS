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
vi.mock("@/modules/attendance/data", () => ({ punch: (...a: unknown[]) => punchMock(...a) }));

import { punchAction } from "@/app/(clerk)/app/attendance/actions";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";

const employee: Actor = { employeeId: "e", employeeCode: "KCF0002", fullName: "E", roles: ["employee"] };

beforeEach(() => {
  actorMock.mockReset();
  punchMock.mockReset();
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
