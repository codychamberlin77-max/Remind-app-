import { requireApiUser } from "@/server/auth/session";
import { clientIp, handle, isUuid } from "@/server/http/handle";
import { hashIp } from "@/server/privacy/crypto";
import { getDocumentFile, NotFoundError } from "@/server/services/documents";

export const runtime = "nodejs";

const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);

/**
 * The only read path to stored files: authenticated, ownership-checked, never
 * cached publicly, and served so the browser cannot execute it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireApiUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) throw new NotFoundError();
    const file = await getDocumentFile(user.id, id, hashIp(clientIp(req)));
    const inline = INLINE.has(file.mimeType) && new URL(req.url).searchParams.get("download") !== "1";
    const safeName = file.filename.replace(/[^\w.\- ]/g, "_");
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType === "text/plain" || file.mimeType === "message/rfc822" ? "text/plain; charset=utf-8" : file.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Browsers' built-in PDF viewers refuse to run under a sandbox CSP; PDFs can't script the page anyway.
        "Content-Security-Policy": file.mimeType === "application/pdf" ? "frame-ancestors 'self'" : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}
