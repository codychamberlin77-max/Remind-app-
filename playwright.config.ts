import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_INBOUND_SECRET = "e2e-inbound-secret-0123456789abcdef";

/**
 * End-to-end tests run against a production build (`npm run build` first) with
 * JOBS_MODE=inline, so no separate worker is needed. Requires DATABASE_URL etc.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: { ...process.env, JOBS_MODE: "inline", APP_URL: `http://localhost:${PORT}`, INBOUND_EMAIL_DOMAIN: "in.lifeos.test", INBOUND_EMAIL_SECRET: E2E_INBOUND_SECRET, SIGNUP_RATE_LIMIT_PER_MINUTE: "50" } as Record<string, string>,
    timeout: 60_000,
  },
});
