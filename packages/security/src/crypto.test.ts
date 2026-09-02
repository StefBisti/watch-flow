import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
  type MasterKey,
} from "./crypto.ts";

const master: MasterKey = { keyId: "v1", key: randomBytes(32) };

test("roundtrips a secret", () => {
  const enc = encryptSecret("Bearer my-api-token", master);
  expect(decryptSecret(enc, master)).toBe("Bearer my-api-token");
});

test("a fresh random IV per encryption — same plaintext, different bytes", () => {
  const a = encryptSecret("same", master);
  const b = encryptSecret("same", master);
  expect(a.iv.equals(b.iv)).toBe(false);
  expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
});

test("tampered ciphertext fails to decrypt", () => {
  const enc = encryptSecret("payload", master);
  enc.ciphertext[enc.ciphertext.length - 1]! ^= 0xff;
  expect(() => decryptSecret(enc, master)).toThrow("secret decryption failed");
});

test("tampered auth tag fails to decrypt", () => {
  const enc = encryptSecret("payload", master);
  enc.ciphertext[4]! ^= 0xff; // inside the tag, just past "v1:"
  expect(() => decryptSecret(enc, master)).toThrow("secret decryption failed");
});

test("tampered IV fails to decrypt", () => {
  const enc = encryptSecret("payload", master);
  enc.iv[0]! ^= 0xff;
  expect(() => decryptSecret(enc, master)).toThrow("secret decryption failed");
});

test("the wrong key fails with the SAME generic error", () => {
  const enc = encryptSecret("payload", master);
  const wrong: MasterKey = { keyId: "v1", key: randomBytes(32) };
  expect(() => decryptSecret(enc, wrong)).toThrow("secret decryption failed");
});

test("an unknown keyId fails, not falls through", () => {
  const enc = encryptSecret("payload", master);
  const other: MasterKey = { keyId: "v9", key: master.key };
  expect(() => decryptSecret(enc, other)).toThrow("secret decryption failed");
});

test("rotation: an old ciphertext decrypts through a key ring", () => {
  const v2: MasterKey = { keyId: "v2", key: randomBytes(32) };
  const oldRow = encryptSecret("legacy", master); // encrypted under v1
  expect(decryptSecret(oldRow, [v2, master])).toBe("legacy");
});

test("AAD binds a ciphertext to its row", () => {
  const enc = encryptSecret("payload", master, "watch_abc");
  expect(decryptSecret(enc, master, "watch_abc")).toBe("payload");
  expect(() => decryptSecret(enc, master, "watch_OTHER")).toThrow(
    "secret decryption failed",
  );
});

test("parseMasterKey accepts the documented format", () => {
  const raw = randomBytes(32);
  const parsed = parseMasterKey(`v1:${raw.toString("base64")}`);
  expect(parsed.keyId).toBe("v1");
  expect(parsed.key.equals(raw)).toBe(true);
});

test("parseMasterKey rejects bad formats and bad lengths", () => {
  for (const bad of [
    "no-prefix-base64",
    `x1:${randomBytes(32).toString("base64")}`,
    `v1:${randomBytes(16).toString("base64")}`, // too short
    `v1:${randomBytes(33).toString("base64")}`, // too long
    "v1:",
  ]) {
    expect(() => parseMasterKey(bad)).toThrow();
  }
});
