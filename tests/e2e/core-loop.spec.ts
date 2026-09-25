import { expect, test } from "@playwright/test";
import { buildSample } from "../../src/server/samples";
import { signUp, waitForReveal } from "./helpers";

function todayNY() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * The MVP success criterion, end to end in a real browser:
 * sign up → upload a receipt → verified facts with certainty labels → action on
 * the dashboard → reminder → correction → complete → delete → isolation.
 */
test("upload → understand → act → remind → correct → complete → delete", async ({ page, browser }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: "Let's find what you're forgetting." })).toBeVisible();

  // Upload a real PDF receipt through the file picker.
  const receipt = await buildSample("receipt", todayNY());
  await page.locator('input[type="file"]').first().setInputFiles({ name: "my-receipt.pdf", mimeType: "application/pdf", buffer: receipt.bytes });
  await waitForReveal(page);

  // The four findings, each with an honest certainty label.
  await expect(page.getByRole("heading", { name: "We found 4 things worth knowing." })).toBeVisible();
  const ret = page.locator("div", { hasText: /^Return window/ }).filter({ hasText: "Estimated: 12 days remaining" }).first();
  await expect(ret).toBeVisible();
  await expect(page.getByText("Based on Best Buy's typical 15-day return policy. Your receipt doesn't specify the return window.")).toBeVisible();
  await expect(page.getByText("2 years", { exact: true })).toBeVisible();
  await expect(page.getByText("Money protected")).toBeVisible();
  await expect(page.getByText("$1,611.33").last()).toBeVisible();

  // Set a reminder straight from the reveal.
  await page.getByRole("button", { name: "Set reminder" }).first().click();
  await page.getByRole("button", { name: "3 days before" }).click();
  await expect(page.getByText(/Reminder set for/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Dashboard surfaces the action with its reason.
  await page.getByRole("link", { name: /Go to my dashboard/ }).click();
  await page.waitForURL("**/home");
  await expect(page.getByRole("heading", { name: "One thing needs your attention." })).toBeVisible();
  await expect(page.getByText(/Your \$1,611\.33 return window likely closes in 12 days \(estimated\)\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /Reminder ·/ })).toBeVisible();

  // Item detail: correct the return deadline → becomes Confirmed and the action follows.
  await page.getByRole("link", { name: /Return window: Samsung/ }).click();
  await page.waitForURL("**/items/**");
  const itemUrl = page.url();
  const fileHref = await page.getByRole("link", { name: "View" }).getAttribute("href");
  const returnRow = page.locator("div.p-4", { hasText: "Return window" }).first();
  await returnRow.getByRole("button", { name: "Edit" }).click();
  const due = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await page.getByRole("dialog").locator("input").fill(due);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(returnRow.getByText("You entered this.")).toBeVisible();
  await expect(returnRow.getByText("Confirmed")).toBeVisible();

  // Complete the action.
  await page.getByRole("button", { name: "Mark complete" }).first().click();
  await expect(page.getByText("Completed.").first()).toBeVisible();

  // Another user cannot see this item or its file.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signUp(p2, "Other");
  const r1 = await p2.goto(itemUrl);
  expect(r1?.status()).toBe(404);
  const r2 = await p2.request.get(fileHref!);
  expect(r2.status()).toBe(404);
  await other.close();

  // Unauthenticated requests are refused.
  const anon = await browser.newContext();
  expect((await anon.request.get(fileHref!)).status()).toBe(401);
  expect((await anon.request.post("/api/documents")).status()).toBe(401);
  await anon.close();

  // Delete the document: the file and everything extracted from it go away.
  await page.goto("/documents");
  await page.getByRole("button", { name: "Delete document" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No documents yet.")).toBeVisible();
  expect((await page.request.get(fileHref!)).status()).toBe(404);
  expect((await page.goto(itemUrl))?.status()).toBe(404);
});

test("samples: subscription trial and airline credit", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: /Free-trial email/ }).click();
  await waitForReveal(page);
  await expect(page.getByText("Free trial ends", { exact: true })).toBeVisible();
  await expect(page.getByText(/StreamMax Premium · \$19\.99\/month/)).toBeVisible();

  await page.getByRole("button", { name: "Add another" }).click();
  await page.getByRole("button", { name: /Airline credit/ }).click();
  await waitForReveal(page);
  await expect(page.getByText("$431 · Delta Air Lines")).toBeVisible();
  await expect(page.getByText("Travel by")).toBeVisible();

  await page.goto("/home");
  await expect(page.getByText(/Your free trial becomes a \$19\.99 charge in 2 days\./)).toBeVisible();

  await page.goto("/search?q=How%20much%20am%20I%20currently%20tracking%3F");
  await expect(page.getByText("Money currently protected")).toBeVisible();
  await expect(page.getByText("$431").first()).toBeVisible();
});

test("rejects unsafe and broken files with a clear message", async ({ page }) => {
  await signUp(page);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "cute.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'),
  });
  await expect(page.getByText("That file type isn't supported.")).toBeVisible({ timeout: 20_000 });
});
