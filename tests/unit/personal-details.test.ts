import { beforeAll, describe, expect, it, vi } from "vitest";
import { maskAadhaar, maskPan, normalizePan, personalDetailsSchema } from "@/modules/employees/personal";

vi.mock("server-only", () => ({}));

describe("PAN and Aadhaar rules", () => {
  it("normalises and masks a PAN, showing only the first five letters and the last one", () => {
    expect(normalizePan(" abcde 1234f ")).toBe("ABCDE1234F");
    expect(maskPan("ABCDE1234F")).toBe("ABCDE••••F");
    expect(maskPan("ABCDE1234F")).not.toContain("1234");
  });

  it("masks Aadhaar to the last 4 digits", () => {
    expect(maskAadhaar("1234")).toBe("XXXX XXXX 1234");
  });

  it("accepts a good PAN and 4 digits, treats empty as leave-alone, and rejects anything else", () => {
    expect(personalDetailsSchema.parse({ pan: "abcde1234f", aadhaarLast4: "0123" })).toEqual({ pan: "ABCDE1234F", aadhaarLast4: "0123" });
    expect(personalDetailsSchema.parse({ pan: "", aadhaarLast4: "" })).toEqual({ pan: "", aadhaarLast4: "" });
    expect(personalDetailsSchema.safeParse({ pan: "ABCDE12345" }).success).toBe(false);
    expect(personalDetailsSchema.safeParse({ pan: "ABCD1234EF" }).success).toBe(false);
    expect(personalDetailsSchema.safeParse({ aadhaarLast4: "123" }).success).toBe(false);
    expect(personalDetailsSchema.safeParse({ aadhaarLast4: "123456789012" }).success).toBe(false); // never a full number
  });
});

describe("field encryption", () => {
  beforeAll(() => {
    process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("round-trips, uses a fresh nonce each time, and keeps the plain value out of the ciphertext", async () => {
    const { encryptField, decryptField } = await import("@/shared/crypto");
    const a = encryptField("ABCDE1234F");
    const b = encryptField("ABCDE1234F");
    expect(a).not.toBe(b);
    expect(a).not.toContain("ABCDE1234F");
    expect(decryptField(a)).toBe("ABCDE1234F");
  });

  it("rejects tampered ciphertext and gives the same blind index for the same PAN only", async () => {
    const { encryptField, decryptField, blindIndex } = await import("@/shared/crypto");
    const [iv, tag, body] = encryptField("ABCDE1234F").split(".");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 1;
    expect(() => decryptField([iv, tag, flipped.toString("base64")].join("."))).toThrow();
    expect(blindIndex("ABCDE1234F")).toBe(blindIndex("ABCDE1234F"));
    expect(blindIndex("ABCDE1234F")).not.toBe(blindIndex("ABCDE1234G"));
  });

  it("refuses to work without a proper key", async () => {
    const { encryptField } = await import("@/shared/crypto");
    process.env.PII_ENCRYPTION_KEY = "short";
    expect(() => encryptField("x")).toThrow("PII_ENCRYPTION_KEY");
    process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
});
