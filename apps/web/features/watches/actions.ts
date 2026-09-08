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
import { watchRunsQueue } from "@/lib/queue";

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

////////////////////////////////////////////////////////////// run watch now

const ENQUEUE_TIMEOUT_MS = 5_000;

export async function runWatchNow(
  watchId: string,
): Promise<ActionResult<{ runId: string }>> {
  const user = await requireUser();
  if (!z.string().min(1).max(64).safeParse(watchId).success)
    return fail("Invalid id");

  const watch = await prisma.watch.findFirst({
    where: { id: watchId, userId: user.id },
    select: { id: true },
  });
  if (!watch) return fail("Not found.");

  const inFlight = await prisma.run.findFirst({
    where: { watchId: watchId, status: { in: ["pending", "running"] } },
    select: { id: true },
  });
  if (inFlight) return ok({ runId: inFlight.id }, "Already running");

  let run: { id: string };
  try {
    run = await prisma.run.create({
      data: {
        watchId: watch.id,
        status: "pending",
        triggered: "manual",
        log: [],
      },
      select: { id: true },
    });
  } catch (e) {
    return fail(mapPrismaError(e));
  }

  try {
    await Promise.race([
      watchRunsQueue().add("run", { runId: run.id }, { jobId: run.id }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("enqueue timed out")),
          ENQUEUE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    console.error("could not enqueue run", run.id, e);
    await prisma.run
      .update({
        where: { id: run.id },
        data: {
          status: "failed",
          error: "coult not queue the run",
          endedAt: new Date(),
        },
      })
      .catch(() => {});
    return fail("Could not start the run. Please try again");
  }
  return ok({ runId: run.id });
}
