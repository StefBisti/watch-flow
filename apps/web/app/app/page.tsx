import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";

export default async function AppPage() {
  const user = await requireUser();

  return (
    <div>
      {user.email}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
