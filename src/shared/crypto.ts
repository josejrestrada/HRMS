import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

// Field encryption for PAN (and later UAN, bank and salary), decision P7. AES-256-GCM with a random
// 96-bit nonce per value. The secret is PII_ENCRYPTION_KEY (32 bytes, base64) and is never stored in
// the database. `KEY_VERSION` is saved with every row so the key can be rotated later.

export const KEY_VERSION = 1;

function secret(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) throw new Error("PII_ENCRYPTION_KEY is missing or is not 32 bytes of base64.");
  return key;
}

// Separate keys for encrypting and for the lookup hash, both derived from the one secret.
const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret(), Buffer.alloc(0), info, 32));

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("hrms-pii-encrypt-v1"), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function decryptField(stored: string): string {
  const [iv, tag, body] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !body) throw new Error("Stored value is not valid ciphertext.");
  const decipher = createDecipheriv("aes-256-gcm", derive("hrms-pii-encrypt-v1"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Keyed hash for finding a duplicate without decrypting anything. */
export function blindIndex(plain: string): string {
  return createHmac("sha256", derive("hrms-pii-index-v1")).update(plain).digest("base64");
}
