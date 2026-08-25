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

////////////////////////////////////////////////////////////// create watch

export type CreateWatchState = ActionResult<void, CreateWatchInput> | null;

export async function createWatch(
  _prevState: CreateWatchState,
  formData: FormData,
) {
  const user = await requireUser();
  const parsed = CreateWatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail(
      "Please fix the errors bellow",
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
  } catch {
    return fail("Could not create watch. Try again.");
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
  const parsed = UpdateWatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail(
      "Please fix the errors bellow",
      z.flattenError(parsed.error).fieldErrors,
    );
  }

  try {
    const { id, ...rest } = parsed.data;
    const { count } = await prisma.watch.updateMany({
      where: { userId: user.id, id: id },
      data: { ...rest },
    });
    if (count === 0) return fail("Not found.");
  } catch {
    return fail("Could not update watch. Try again.");
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
  } catch {
    return fail("Could not delete watch. Try again.");
  }

  revalidatePath("/watches");

  return ok(undefined, "Watch deleted");
}
