import { expect, type Page } from "@playwright/test";

export async function signUp(page: Page, name = "Casey") {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/welcome");
  return email;
}

export async function waitForReveal(page: Page) {
  await expect(page.getByRole("heading", { name: /We found \d+ things? worth knowing/ })).toBeVisible({ timeout: 30_000 });
}
