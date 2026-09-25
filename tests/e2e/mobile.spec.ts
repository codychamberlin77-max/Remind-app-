import { expect, test } from "@playwright/test";
import { signUp, waitForReveal } from "./helpers";

test("mobile: first-run sample, reveal and dashboard fit a phone screen", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
  await page.getByRole("button", { name: /Electronics receipt/ }).click();
  await waitForReveal(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/mobile-reveal.png", fullPage: true });
  await page.getByRole("link", { name: /Go to my dashboard/ }).click();
  await expect(page.getByRole("heading", { name: /needs your attention/ })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Search" })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-home.png", fullPage: true });
});
