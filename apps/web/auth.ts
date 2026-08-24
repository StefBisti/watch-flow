import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@watchflow/db";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [GitHub],
  session: {
    strategy: "database",
    maxAge: 60 * 60 * 24 * 7,
  },
});
