import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/authz";
import Link from "next/link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/watches" className="font-semibold">
          WatchFlow
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
            >
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">{children}</main>
    </div>
  );
}
