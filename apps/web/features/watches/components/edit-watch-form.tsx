"use client";

import { useActionState } from "react";
import { updateWatch, UpdateWatchState } from "../actions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = { watch: { id: string; name: string; intervalMin: number } };

export function EditWatchForm({ watch }: Props) {
  const [state, formAction, isPending] = useActionState<
    UpdateWatchState,
    FormData
  >(updateWatch, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={watch.id} />

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={watch.name} required />
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
          defaultValue={watch.intervalMin}
          required
        />
        {errors?.intervalMin && (
          <p className="text-destructive text-sm">{errors.intervalMin[0]}</p>
        )}
      </div>

      {state && !state.ok && !state.fieldErrors && (
        <p className="text-destructive text-sm">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
