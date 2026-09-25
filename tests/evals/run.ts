/**
 * Usage:
 *   npm run eval                              # mock provider (recorded responses)
 *   npm run eval -- --provider anthropic      # live model on the same documents
 *   npm run eval -- --only clean_receipt,ambiguous_date
 *   npm run eval -- --strict                  # non-zero exit on any false deadline
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

process.env.AI_PROVIDER = provider;
process.env.JOBS_MODE = "inline";

const { runEval, formatReport } = await import("./evaluate");
const { closeDb } = await import("@/server/db/client");

const report = await runEval({ provider, only });
console.log(formatReport(report));
await mkdir("tests/evals/reports", { recursive: true });
const out = `tests/evals/reports/${provider}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nreport: ${out}`);
await closeDb();

if (report.metrics.falseDeadlines > 0 || (strict && provider === "mock" && report.metrics.extractionAccuracy < 1)) {
  process.exit(1);
}
process.exit(0);
