/**
 * Usage:
 *   npm run eval                              # mock provider (recorded responses)
 *   npm run eval -- --provider anthropic      # live model on the same documents
 *   npm run eval -- --only clean_receipt,ambiguous_date
 *   npm run eval -- --strict                  # non-zero exit on any false deadline
 *
 * Hosted (Railway): set LIFEOS_ROLE=eval on the worker service. It runs this
 * once with the service's own AI key, prints the report to the deploy logs,
 * deletes the throwaway eval users (--cleanup) and then idles (--hold) so the
 * platform doesn't restart it and re-bill the run.
 *
 * Uses DATABASE_URL from the environment (.env). Each case runs as a fresh user.
 */
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const provider = arg("provider") ?? "mock";
const only = arg("only")?.split(",").filter(Boolean);
const strict = args.includes("--strict");
const cleanup = args.includes("--cleanup");
const hold = args.includes("--hold");

process.env.AI_PROVIDER = provider;
process.env.JOBS_MODE = "inline";

const { runEval, formatReport } = await import("./evaluate");
const { closeDb } = await import("@/server/db/client");

console.log(`[eval] running ${only?.length ?? "all"} cases with provider=${provider}…`);
const report = await runEval({ provider, only });
console.log(formatReport(report));
console.log(`[eval] summary ${JSON.stringify({ provider, ...report.metrics, calibration: undefined })}`);
try {
  await mkdir("tests/evals/reports", { recursive: true });
  const out = `tests/evals/reports/${provider}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${out}`);
} catch {
  /* read-only filesystem: the logs above are the report */
}
if (cleanup) {
  const { db } = await import("@/server/db/client");
  const { sql } = await import("drizzle-orm");
  const res = await db().execute(sql`delete from users where email like 'eval-%@example.com'`);
  console.log(`[eval] cleaned up ${res.rowCount ?? 0} throwaway eval users`);
}
await closeDb();

if (hold) {
  console.log("[eval] done. Set LIFEOS_ROLE back to \"worker\" on this service to resume normal operation.");
  setInterval(() => undefined, 1 << 30);
  await new Promise(() => undefined);
}

if (report.metrics.falseDeadlines > 0 || (strict && provider === "mock" && report.metrics.extractionAccuracy < 1)) {
  process.exit(1);
}
process.exit(0);
