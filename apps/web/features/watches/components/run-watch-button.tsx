"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runWatchNow } from "../actions";

const POLL_MS = 1500;
const MAX_POLLS = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RunStatusResponse = { status: string; error: string | null };

export function RunWatchButton({ id }: { id: string }) {
  const [running, setRunning] = useState(false);
  const router = useRouter();

  async function onClick() {
    setRunning(true);
    try {
      const started = await runWatchNow(id);
      if (!started.ok) {
        toast.error(started.error);
        return;
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);

        // nosemgrep: no-raw-fetch - browser-side fetch
        const res = await fetch(`/api/runs/${started.data.runId}`);
        if (!res.ok) {
          toast.error("Could not read the run status");
          return;
        }

        const run: RunStatusResponse = await res.json();
        if (run.status === "success") {
          toast.success("Run finished");
          return;
        }
        if (run.status === "failed") {
          toast.error(run.error ?? "Run failed");
          return;
        }
      }
      toast.error("Run is taking longer than expected");
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={running}
      onClick={onClick}
      className="cursor-pointer"
    >
      {running ? "Running…" : "Run now"}
    </Button>
  );
}
