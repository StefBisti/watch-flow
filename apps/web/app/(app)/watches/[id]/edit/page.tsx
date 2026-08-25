import { getWatch } from "@/features/watches/queries";
import { notFound } from "next/navigation";
import { EditWatchForm } from "@/features/watches/components/edit-watch-form";

export default async function EditWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const watch = await getWatch(id);
  if (!watch) notFound();

  return (
    <div className="max-w-md flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Edit watch</h1>
      <EditWatchForm
        watch={{
          id: watch.id,
          name: watch.name,
          intervalMin: watch.intervalMin,
        }}
      />
    </div>
  );
}
