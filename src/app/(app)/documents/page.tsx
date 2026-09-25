import { Eye, FileText, Image as ImageIcon, Mail } from "lucide-react";
import Link from "next/link";
import { DeleteDocument } from "@/components/app/item-controls";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { listDocuments } from "@/server/services/documents";

export const metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  queued: "Waiting…",
  processing: "Reading…",
  processed: "Done",
  needs_review: "Needs a check",
  failed: "Couldn't process",
  unsupported: "Couldn't read",
};

export default async function Documents() {
  const user = await requireUser();
  const docs = await listDocuments(user.id);
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Documents</h1>
          <p className="text-muted text-[14px] mt-1">{docs.length} {docs.length === 1 ? "document" : "documents"}. Deleting one removes everything we found in it.</p>
        </div>
        <Button asChild size="sm"><Link href="/add">Add</Link></Button>
      </div>
      <Card className="mt-6 divide-y divide-line overflow-hidden">
        {docs.length === 0 ? <p className="p-6 text-center text-muted text-[14.5px]">No documents yet.</p> : null}
        {docs.map((d) => {
          const Icon = d.mimeType.startsWith("image/") ? ImageIcon : d.mimeType === "message/rfc822" ? Mail : FileText;
          return (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3.5">
              <Icon className="size-4 text-subtle shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[14.5px] font-medium truncate">{d.originalFilename}</p>
                <p className="text-[12.5px] text-subtle">
                  {d.source === "sample" ? "Sample · " : ""}
                  {d.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {STATUS[d.status] ?? d.status}
                  {d.failureReason && d.status !== "processed" ? ` — ${d.failureReason}` : ""}
                </p>
              </div>
              <Button asChild size="sm" variant="ghost" aria-label="View">
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener"><Eye className="size-4" /></a>
              </Button>
              <DeleteDocument documentId={d.id} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}
