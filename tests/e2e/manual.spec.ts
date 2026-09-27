import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("lost receipt: type item + store, get return window and warranty with sources", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: /Lost the receipt\?/ }).click();
  await page.waitForURL("**/add/manual");
  await page.getByLabel("What did you buy?").fill("Brightline 55-inch TV");
  await page.getByLabel("Where did you buy it?").fill("Gadget Barn");
  const d = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Purchase date").fill(d);
  await page.getByRole("button", { name: /Find my return window/ }).click();
  await page.waitForURL("**/items/**");
  await expect(page.getByRole("heading", { name: "Brightline 55-inch TV" })).toBeVisible();
  await expect(page.getByText(/Gadget Barn's return policy page/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Brightline's warranty page/)).toBeVisible();
  await expect(page.getByRole("link", { name: /View the policy/ }).first()).toHaveAttribute("href", /gadgetbarn\.example/);
  await expect(page.getByText(/No receipt\?/)).toBeVisible();
});

test("automatic reminders: scheduled for every deadline, visible in settings and the bell", async ({ page }) => {
  await signUp(page);
  await page.goto("/add/manual");
  await page.getByLabel("What did you buy?").fill("Throw pillow");
  await page.getByLabel("Where did you buy it?").fill("Target");
  await page.getByLabel("Purchase date").fill(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: /Find my return window/ }).click();
  await page.waitForURL("**/items/**");

  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: /Automatic reminders/ })).toHaveAttribute("aria-checked", "true");
  for (const label of ["Automatic, 1 week before", "Automatic, 3 days before", "Automatic, on the day"]) {
    await expect(page.getByText(new RegExp(label)).first()).toBeVisible();
  }
  // Turn off "On the day" → that reminder disappears.
  await page.getByRole("button", { name: "On the day" }).click();
  await expect(page.getByText(/Automatic, on the day/)).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole("link", { name: /Notifications/ }).click();
  await page.waitForURL("**/notifications");
  await expect(page.getByText(/We remind you 1 week and 3 days before each deadline/)).toBeVisible();
  await expect(page.getByText("No reminders yet")).toBeVisible();
});
