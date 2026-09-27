import { EmailSetup } from "@/components/app/email-setup";
import { requireUser } from "@/server/auth/session";
import { listImports } from "@/server/services/emailImport";
import { getForwardingStatus } from "@/server/services/inbound";

export const metadata = { title: "Email" };
export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const user = await requireUser();
  const [status, imports] = await Promise.all([getForwardingStatus(user.id), listImports(user.id)]);
  return <EmailSetup initialStatus={JSON.parse(JSON.stringify(status))} initialImports={JSON.parse(JSON.stringify(imports))} />;
}
