import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Empty, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/authz";
import { prisma } from "@watchflow/db";

export default async function WatchesPage() {
  const user = await requireUser();

  return (
    <div>
      {result.length === 0 ? (
        <Empty>
          <EmptyTitle>No watches</EmptyTitle>
        </Empty>
      ) : (
        <Table>
          <TableCaption>Your watches</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
              <TableHead>interval</TableHead>
              <TableHead>enabled</TableHead>
              <TableHead>lastStatus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.intervalMin}</TableCell>
                <TableCell>{r.enabled ? "Yes" : "No"}</TableCell>
                <TableCell>{r.lastStatus ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <Button type="submit">Sign out</Button>
      </form>
    </div>
  );
}
