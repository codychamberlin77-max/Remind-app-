import { EmailSetup } from "@/components/app/email-setup";
import { InboxConnections } from "@/components/app/inbox-connections";
import { requireUser } from "@/server/auth/session";
import { mailProvider } from "@/server/mail/providers";
import { listConnections } from "@/server/services/connections";
import { listImports } from "@/server/services/emailImport";
import { getForwardingStatus } from "@/server/services/inbound";

export const metadata = { title: "Email" };
export const dynamic = "force-dynamic";

export default async function EmailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const q = await searchParams;
  const [status, imports, connections] = await Promise.all([getForwardingStatus(user.id), listImports(user.id), listConnections(user.id)]);
  // Dates become strings on the way to the client.
  const plain = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
  return (
    <EmailSetup
      initialStatus={plain(status)}
      initialImports={plain(imports)}
      connect={
        <InboxConnections
          connections={plain(connections)}
          available={{ gmail: mailProvider("gmail").configured(), outlook: mailProvider("outlook").configured() }}
          justConnected={q.connected === "gmail" || q.connected === "outlook" ? q.connected : null}
          connectError={q.connect_error ?? null}
        />
      }
    />
  );
}
