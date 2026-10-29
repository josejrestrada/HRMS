import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock(), currentUser: () => currentUserMock() }));
const findMock = vi.fn();
const linkMock = vi.fn();
vi.mock("@/modules/employees/data", () => ({
  findActorByClerkUserId: (...a: unknown[]) => findMock(...a),
  linkActorByVerifiedEmail: (...a: unknown[]) => linkMock(...a),
}));

import { getCurrentActor } from "@/shared/auth";
import type { Actor } from "@/shared/roles";

const actor: Actor = { employeeId: "1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const verifiedEmail = { emailAddress: "a@example.invalid", verification: { status: "verified" } };

beforeEach(() => {
  authMock.mockReset();
  currentUserMock.mockReset();
  findMock.mockReset();
  linkMock.mockReset();
});

describe("getCurrentActor", () => {
  it("returns null and touches nothing when nobody is signed in", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect(await getCurrentActor()).toBeNull();
    expect(findMock).not.toHaveBeenCalled();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("returns the linked employee without trying to link again", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    findMock.mockResolvedValue(actor);
    expect(await getCurrentActor()).toBe(actor);
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("does not link an unverified email", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    findMock.mockResolvedValue(null);
    currentUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "a@example.invalid", verification: { status: "unverified" } } });
    expect(await getCurrentActor()).toBeNull();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("does not link when there is no primary email", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    findMock.mockResolvedValue(null);
    currentUserMock.mockResolvedValue({ primaryEmailAddress: null });
    expect(await getCurrentActor()).toBeNull();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("links a verified email and returns the employee", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    findMock.mockResolvedValue(null);
    currentUserMock.mockResolvedValue({ primaryEmailAddress: verifiedEmail });
    linkMock.mockResolvedValue(actor);
    expect(await getCurrentActor()).toBe(actor);
    expect(linkMock).toHaveBeenCalledWith("user_1", "a@example.invalid");
  });

  it("gives no access when no employee matches the verified email", async () => {
    authMock.mockResolvedValue({ userId: "user_1" });
    findMock.mockResolvedValue(null);
    currentUserMock.mockResolvedValue({ primaryEmailAddress: verifiedEmail });
    linkMock.mockResolvedValue(null);
    expect(await getCurrentActor()).toBeNull();
  });
});
