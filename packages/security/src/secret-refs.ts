const SECRET_REF = /\{\{secret\.([A-Z][A-Z0-9_]{0,63})\}\}/g;

/**
 * Swaps {{secret.NAME}} for its decrypted value in header VALUES only.
 * Throws on an unknown name
 */
export function resolveSecretRefs(
  headers: Record<string, string> | undefined,
  secrets: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      value.replace(SECRET_REF, (_, ref: string) => {
        if (!Object.hasOwn(secrets, ref)) {
          throw new Error(`unknown secret ${ref}`);
        }
        return secrets[ref];
      }),
    ]),
  );
}
