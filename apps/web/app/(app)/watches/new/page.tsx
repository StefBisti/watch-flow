import { CreateWatchForm } from "@/features/watches/components/create-watch-form";

export default function NewWatchPage() {
  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">New watch</h1>
      <CreateWatchForm />
    </div>
  );
}
