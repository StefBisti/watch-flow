import { getCurrentUser } from "@/lib/authz";
import { prisma } from "@watchflow/db";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // getCurrentUser, not requireUser: this endpoint is polled by fetch(), and
  // requireUser's redirect() would answer with a 307 to the sign-in page
  // instead of a status the caller can act on.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped through the watch relation, so run ids are not enumerable
  // across accounts. Someone else's run is a 404 rather than a 403 — that
  // answer leaks nothing about whether the id exists at all.
  const run = await prisma.run.findFirst({
    where: { id, watch: { userId: user.id } },
    select: { status: true, error: true },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A polled endpoint must never be cached, by the browser or by a proxy.
  return NextResponse.json(run, {
    headers: { "cache-control": "no-store" },
  });
}
