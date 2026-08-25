import { Prisma } from "@watchflow/db";
export function mapPrismaError(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "A record with this value already exists.";
    if (e.code === "P2025") return "Record not found.";
    if (e.code === "P2003") return "Related record not found.";
  }
  console.error(e);
  return "Something went wrong. Please try again.";
}
