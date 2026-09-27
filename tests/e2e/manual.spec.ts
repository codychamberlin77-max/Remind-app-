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
