import { AppNav } from "@/components/app/nav";
import { requireUser } from "@/server/auth/session";

// Every signed-in page depends on the session: never prerender at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh pb-20 sm:pb-0">
      <AppNav name={user.name} />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">{children}</main>
    </div>
  );
}
