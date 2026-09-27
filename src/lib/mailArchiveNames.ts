import { basename } from "./basename";

/**
 * Mail export filenames the import accepts (the content is sniffed again when
 * scanning). Shared by the upload page and the server.
 */
export function isAcceptedArchiveName(filename: string): boolean {
  const base = basename(filename);
  if (/\.(mbox|mbx|zip|pst|ost|olm)$/i.test(base)) return true;
  // Apple Mail's inner "mbox" file and Thunderbird's "Inbox"/"Sent" have no extension.
  return base.length > 0 && !base.includes(".");
}
