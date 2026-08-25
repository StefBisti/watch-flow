"use server";

import { ActionResult, fail, ok } from "@/lib/action-result";
import {
  CreateWatchInput,
  CreateWatchSchema,
  UpdateWatchInput,
  UpdateWatchSchema,
} from "./schemas";
import { requireUser } from "@/lib/authz";
import z from "zod";
import { prisma } from "@watchflow/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mapPrismaError } from "@/lib/prisma-errors";

////////////////////////////////////////////////////////////// create watch

export type CreateWatchState = ActionResult<void, CreateWatchInput> | null;

export async function createWatch(
  _prevState: CreateWatchState,
  formData: FormData,
) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = CreateWatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "Please fix the errors below",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  try {
    await prisma.watch.create({
      data: {
        ...parsed.data,
        userId: user.id,
        flow: { version: 1, nodes: [], edges: [] },
        nextRunAt: new Date(Date.now() + parsed.data.intervalMin * 60_000),
      },
    });
  } catch (e) {
    return fail(mapPrismaError(e));
  }

  revalidatePath("/watches");
  redirect("/watches");
}

////////////////////////////////////////////////////////////// update watch

export type UpdateWatchState = ActionResult<void, UpdateWatchInput> | null;

export async function updateWatch(
  _prevState: UpdateWatchState,
  formData: FormData,
) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = UpdateWatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "Please fix the errors below",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  try {
    const { id, ...rest } = parsed.data;
    const { count } = await prisma.watch.updateMany({
      where: { userId: user.id, id: id },
      data: {
        ...rest,
        nextRunAt: new Date(Date.now() + parsed.data.intervalMin * 60_000),
      },
    });
    if (count === 0) return fail("Not found.");
  } catch (e) {
    return fail(mapPrismaError(e));
  }

  revalidatePath("/watches");
  redirect("/watches");
}

////////////////////////////////////////////////////////////// delete watch

export async function deleteWatch(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.cuid2().safeParse(id).success) return fail("Invalid id");

  try {
    const { count } = await prisma.watch.deleteMany({
      where: { id, userId: user.id },
    });
    if (count === 0) return fail("Not found.");
  } catch (e) {
    return fail(mapPrismaError(e));
  }

  revalidatePath("/watches");

  return ok(undefined, "Watch deleted");
}
