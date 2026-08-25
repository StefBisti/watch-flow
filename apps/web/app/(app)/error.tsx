"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
