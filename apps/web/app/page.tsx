import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">WatchFlow</h1>
      <p className="text-muted-foreground max-w-md">
        Monitor any page or API for changes. Build a flow, run it on a schedule,
        get notified.
      </p>
      <Button nativeButton={false} render={<Link href="/watches" />}>
        Go to your watches
      </Button>
    </main>
  );
}
