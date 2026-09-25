import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";
import { closeAdmin } from "./db";

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});
