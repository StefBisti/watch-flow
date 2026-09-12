"use server";

import { ActionResult, fail, ok } from "@/lib/action-result";
import { CreateSecretInput, CreateSecretSchema } from "./schemas";
import { requireUser } from "@/lib/authz";
import z from "zod";
import { revalidatePath } from "next/cache";
import { mapPrismaError } from "@/lib/prisma-errors";
import { prisma } from "@watchflow/db";
import { encryptSecret, parseMasterKey } from "@watchflow/security";
import { env } from "@/lib/env";

////////////////////////////////////////////////////////////// create secret

export type CreateSecretState = ActionResult<void, CreateSecretInput> | null;

export async function createSecret(
  _prevState: CreateSecretState,
  formData: FormData,
) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = CreateSecretSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "Please fix the errors below",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  // make sure the id actually exists and is tied to that user
  const watch = await prisma.watch.findFirst({
    where: { id: parsed.data.watchId, userId: user.id },
    select: { id: true },
  });
  if (!watch) return fail("Not found");

  try {
    const { iv, ciphertext } = encryptSecret(
      parsed.data.value,
      parseMasterKey(env.SECRETS_MASTER_KEY),
      watch.id,
    );
    const bytes = {
      iv: new Uint8Array(iv),
      ciphertext: new Uint8Array(ciphertext),
    };

    await prisma.watchSecret.upsert({
      where: { watchId_name: { watchId: watch.id, name: parsed.data.name } },
      create: {
        watchId: watch.id,
        name: parsed.data.name,
        ...bytes,
      },
      update: bytes,
    });
  } catch (e) {
    return fail(mapPrismaError(e));
  }

  revalidatePath(`/watches/${watch.id}/edit`);
  return ok(undefined, "Secret saved");
}
