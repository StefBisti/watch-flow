"use client";

import { useActionState, useState } from "react";
import { createWatch, type CreateWatchState } from "../actions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreateWatchForm() {
  const [state, formAction, isPending] = useActionState<
    CreateWatchState,
    FormData
  >(createWatch, null);
  const [name, setName] = useState("");
  const [intervalMin, setIntervalMin] = useState("60");
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors?.name}
        />
        {errors?.name && (
          <p className="text-destructive text-sm">{errors.name[0]}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="intervalMin">Interval (minutes)</Label>
        <Input
          id="intervalMin"
          name="intervalMin"
          type="number"
          min={15}
          max={1440}
          value={intervalMin}
          onChange={(e) => setIntervalMin(e.target.value)}
          required
          aria-invalid={!!errors?.intervalMin}
        />
        {errors?.intervalMin && (
          <p className="text-destructive text-sm">{errors.intervalMin[0]}</p>
        )}
      </div>

      {state && !state.ok && !state.fieldErrors && (
        <p className="text-destructive text-sm">{state.error}</p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating" : "Create"}
      </Button>
    </form>
  );
}
