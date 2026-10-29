import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const txQuery = vi.fn();
const plainQuery = vi.fn();
vi.mock("@/shared/db", () => ({
  query: (...a: unknown[]) => plainQuery(...a),
  transaction: async (fn: (tx: { query: typeof txQuery }) => Promise<unknown>) => fn({ query: txQuery }),
}));

import { linkActorByVerifiedEmail } from "@/modules/employees/data";

const actorRow = { id: "e1", employee_code: "KCF0001", full_name: "A", roles: ["hr_admin"] };

beforeEach(() => {
  txQuery.mockReset();
  plainQuery.mockReset();
});

describe("linkActorByVerifiedEmail", () => {
  it("returns null and writes no audit entry when no employee matches", async () => {
    txQuery.mockResolvedValueOnce([]);
    expect(await linkActorByVerifiedEmail("user_1", "x@example.invalid")).toBeNull();
    expect(txQuery).toHaveBeenCalledTimes(1);
  });

  it("writes the link and its audit entry in the same transaction", async () => {
    txQuery.mockResolvedValueOnce([{ id: "e1" }]).mockResolvedValueOnce([]);
    plainQuery.mockResolvedValueOnce([actorRow]);
    const actor = await linkActorByVerifiedEmail("user_1", "a@example.invalid");
    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(String(txQuery.mock.calls[1][0])).toContain("insert into audit_log");
    expect(actor?.roles).toEqual(["employee", "hr_admin"]);
  });

  it("treats a unique violation as no match", async () => {
    txQuery.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505" }));
    expect(await linkActorByVerifiedEmail("user_1", "a@example.invalid")).toBeNull();
  });

  it("does not swallow other database errors", async () => {
    txQuery.mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "08006" }));
    await expect(linkActorByVerifiedEmail("user_1", "a@example.invalid")).rejects.toThrow("connection lost");
  });

  it("does not leave a link behind when the audit write fails", async () => {
    // The whole callback runs in one transaction, so a failing audit insert throws out of it.
    txQuery.mockResolvedValueOnce([{ id: "e1" }]).mockRejectedValueOnce(new Error("audit failed"));
    await expect(linkActorByVerifiedEmail("user_1", "a@example.invalid")).rejects.toThrow("audit failed");
  });
});
