import { describe, expect, it } from "vitest";
import { bankSchema, maskDigits } from "@/modules/employees/bank";

describe("bank rules", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskDigits("123456789012")).toBe("••••••••9012");
    expect(maskDigits("12345678")).toBe("••••5678");
  });
  it("cleans and checks what was typed", () => {
    const ok = bankSchema.parse({ ifsc: " sbin0001234", account: "1234 5678 9012", uan: "1002-0030-0400", salary: "45,000" });
    expect(ok).toMatchObject({ ifsc: "SBIN0001234", account: "123456789012", uan: "100200300400", salary: "45000" });
  });
  it("rejects bad values and accepts empty boxes", () => {
    expect(bankSchema.safeParse({ ifsc: "SBIN1001234" }).success).toBe(false);
    expect(bankSchema.safeParse({ account: "1234" }).success).toBe(false);
    expect(bankSchema.safeParse({ uan: "12345" }).success).toBe(false);
    expect(bankSchema.safeParse({ salary: "0" }).success).toBe(false);
    expect(bankSchema.safeParse({ salary: "99999999999" }).success).toBe(false);
    expect(bankSchema.safeParse({ ifsc: "", account: "", uan: "", salary: "" }).success).toBe(true);
  });
});
