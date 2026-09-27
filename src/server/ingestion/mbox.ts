import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * Stream an mbox file one message at a time (constant memory, any file size).
 * Handles Google Takeout's mboxrd format: a "From " separator line after a blank
 * line starts a message, and ">From " in bodies is un-escaped.
 */
export type MboxMessage = { raw: Buffer; oversized: boolean };

/** "From <sender> <asctime date>", e.g. "From 1790000000@xxx Mon Sep 14 10:00:00 +0000 2026". */
const SEPARATOR = /^From \S+ +(Mon|Tue|Wed|Thu|Fri|Sat|Sun) .*\d{4}\s*$/;

export async function* splitMbox(input: Readable, maxMessageBytes = 25 * 1024 * 1024): AsyncGenerator<MboxMessage> {
  input.setEncoding("latin1"); // byte-preserving: 1 char = 1 byte
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lines: string[] = [];
  let size = 0;
  let oversized = false;
  let started = false;
  let prevBlank = true;

  const flush = (): MboxMessage | null => {
    if (!started || (!lines.length && !oversized)) return null;
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const msg = { raw: Buffer.from(lines.join("\r\n"), "latin1"), oversized };
    lines = [];
    size = 0;
    oversized = false;
    return msg;
  };

  for await (const line of rl) {
    if ((prevBlank || !started) && SEPARATOR.test(line)) {
      const done = flush();
      if (done) yield done;
      started = true;
      prevBlank = false;
      continue;
    }
    prevBlank = line === "";
    if (!started) continue;
    if (oversized) continue;
    const l = /^>+From /.test(line) ? line.slice(1) : line;
    size += l.length + 2;
    if (size > maxMessageBytes) {
      oversized = true;
      lines = [];
      continue;
    }
    lines.push(l);
  }
  const last = flush();
  if (last) yield last;
}
