import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/security/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      APP_URL: "http://localhost:3000",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://lifeos_app:lifeos_app@localhost:5432/lifeos_test",
      DATABASE_ADMIN_URL:
        process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/lifeos_test",
      APP_DB_PASSWORD: "lifeos_app",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: ".data/test-objects",
      AI_PROVIDER: "mock",
      FIELD_ENCRYPTION_KEY: "rbnThpE3/lB91x/kkJX83mUynjMNKY5jhEU+6wqTbeg=",
      EMAIL_DRIVER: "log",
      JOBS_MODE: "inline",
    },
  },
});
