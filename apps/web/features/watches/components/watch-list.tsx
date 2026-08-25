import { Empty, EmptyTitle } from "@/components/ui/empty";
import { listWatches } from "../queries";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DeleteWatchButton } from "./delete-watch-button";

type Watch = Awaited<ReturnType<typeof listWatches>>[number];

export function WatchList({ watches }: { watches: Watch[] }) {
  if (watches.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No watches yet</EmptyTitle>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Interval</TableHead>
          <TableHead>Enabled</TableHead>
          <TableHead>Last status</TableHead>
          <TableHead className="w-32"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {watches.map((w) => (
          <TableRow key={w.id}>
            <TableCell>{w.name}</TableCell>
            <TableCell>{w.intervalMin} min</TableCell>
            <TableCell>{w.enabled ? "Yes" : "No"}</TableCell>
            <TableCell>{w.lastStatus ?? "-"}</TableCell>
            <TableCell className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href={`/watches/${w.id}/edit`} />}
              >
                Edit
              </Button>
              <DeleteWatchButton id={w.id} name={w.name} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
