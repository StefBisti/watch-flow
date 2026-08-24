import "server-only";
import { auth } from "@/auth";
import { cache } from "react";
import { redirect } from "next/navigation";
import { User } from "next-auth";

export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session || !session.user) return null;
  return session.user;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) return redirect("/api/auth/signin");
  return user;
}
