import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce size
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Bounded so parseMasterKey and decryptSecret agree: a longer keyId would
// encrypt rows that decryptSecret's separator scan then refuses to read,
// which is silent permanent data loss.
const MAX_KEY_ID_LENGTH = 8;
const KEY_ID = /^v\d{1,7}$/;

export type MasterKey = { keyId: string; key: Buffer };

/**
 * Parses the SECRETS_MASTER_KEY env value: "v1:<base64 of 32 bytes>".
 * The keyId prefix is what makes rotation possible later: encrypt with v2,
 * keep decrypting old rows with v1 until a re-encrypt job has run.
 */
export function parseMasterKey(value: string): MasterKey {
  const sep = value.indexOf(":");
  const keyId = sep === -1 ? "" : value.slice(0, sep);
  if (!KEY_ID.test(keyId)) {
    throw new Error('SECRETS_MASTER_KEY must look like "v1:<base64>"');
  }
  const key = Buffer.from(value.slice(sep + 1), "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("SECRETS_MASTER_KEY must decode to exactly 32 bytes");
  }
  return { keyId, key };
}

/** Matches the WatchSecret columns: both stored as Bytes. */
export type EncryptedSecret = { iv: Buffer; ciphertext: Buffer };

// ciphertext layout: utf8(keyId) ":" authTag(16 bytes) encryptedData
// The keyId travels inside the ciphertext column so rotation needs no schema
// change; GCM's auth tag makes the whole thing tamper-evident.

/**
 * @param aad Optional additional authenticated data — bind the ciphertext to
 * its owning row (e.g. the watchId) so a ciphertext copied into another row
 * fails to decrypt instead of decrypting under the wrong owner.
 */
export function encryptSecret(
  plaintext: string,
  master: MasterKey,
  aad?: string,
): EncryptedSecret {
  // Fresh random IV per encryption. GCM with a reused key+IV pair leaks
  // the XOR of plaintexts AND allows tag forgery — never derive, never reuse.
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, master.key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv,
    ciphertext: Buffer.concat([
      Buffer.from(`${master.keyId}:`, "utf8"),
      tag,
      data,
    ]),
  };
}

/**
 * @param keys One key or a ring of keys (rotation): the ciphertext's own
 * keyId prefix selects which one decrypts it.
 */
export function decryptSecret(
  secret: EncryptedSecret,
  keys: MasterKey | MasterKey[],
  aad?: string,
): string {
  // Every failure path throws the SAME generic error. Distinguishing
  // "unknown key" from "bad tag" from "wrong AAD" hands an attacker with
  // database access an oracle.
  const fail = () => new Error("secret decryption failed");

  const ring = Array.isArray(keys) ? keys : [keys];
  const sep = secret.ciphertext.indexOf(0x3a); // ":"
  if (sep === -1 || sep > MAX_KEY_ID_LENGTH) throw fail();
  const keyId = secret.ciphertext.subarray(0, sep).toString("utf8");
  const master = ring.find((k) => k.keyId === keyId);
  if (!master) throw fail();

  const tag = secret.ciphertext.subarray(sep + 1, sep + 1 + TAG_LENGTH);
  const data = secret.ciphertext.subarray(sep + 1 + TAG_LENGTH);
  if (tag.length !== TAG_LENGTH) throw fail();

  try {
    const decipher = createDecipheriv(ALGORITHM, master.key, secret.iv);
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw fail();
  }
}
