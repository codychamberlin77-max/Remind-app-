import { execFileSync } from "node:child_process";

export default function setup() {
  const admin = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/lifeos_test";
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_ADMIN_URL: admin, APP_DB_PASSWORD: "lifeos_app" },
  });
}
