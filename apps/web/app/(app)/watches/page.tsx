import { Button } from "@/components/ui/button";
import { listWatches } from "@/features/watches/queries";
import { WatchList } from "@/features/watches/components/watch-list";
import Link from "next/link";

export default async function WatchesPage() {
  const watches = await listWatches();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Watches</h1>
        <Button nativeButton={false} render={<Link href="/watches/new" />}>
          New watch
        </Button>
      </div>
      <WatchList watches={watches} />
    </div>
  );
}
