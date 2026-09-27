import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

const SECRET = "e2e-inbound-secret-0123456789abcdef"; // matches playwright.config.ts

test("email: forwarding address, Gmail guide, and a forwarded receipt shows up", async ({ page }) => {
  await signUp(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Set up" }).click();
  await page.waitForURL("**/email");

  const address = (await page.getByTestId("forwarding-address").textContent())!.trim();
  expect(address).toMatch(/^[a-z2-9]{12}@in\.lifeos\.test$/);
  await expect(page.getByTestId("gmail-filter")).toContainText('"free trial"');
  await expect(page.getByRole("button", { name: "Upload mail export" })).toBeVisible();

  // Simulate the Cloudflare Email Worker delivering a Gmail confirmation, then a receipt.
  const deliver = async (raw: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", SECRET).update(`${ts}.${address}.`).update(Buffer.from(raw)).digest("hex");
    const res = await page.request.post("/api/inbound/email", {
      headers: { "x-lifeos-timestamp": ts, "x-lifeos-to": address, "x-lifeos-signature": sig, "content-type": "message/rfc822" },
      data: Buffer.from(raw),
    });
    expect(res.status()).toBe(200);
  };
  await deliver(
    "From: Gmail Team <forwarding-noreply@google.com>\r\nSubject: (#551234987) Gmail Forwarding Confirmation - Receive Mail from casey@gmail.com\r\nMessage-ID: <gfc-e2e@google.com>\r\n\r\nConfirmation code: 551234987\r\n",
  );
  await expect(page.getByTestId("gmail-verification")).toContainText("551234987", { timeout: 15_000 });

  const date = new Date(Date.now() - 3 * 86_400_000).toUTCString();
  await deliver(
    `From: Best Buy <BestBuyInfo@emailinfo.bestbuy.com>\r\nSubject: Your Best Buy order #BBY01-77\r\nDate: ${date}\r\nMessage-ID: <e2e-${Date.now()}@bestbuy.com>\r\nContent-Type: text/plain\r\n\r\nThanks for your order.\r\nSamsung 65" TV\r\nOrder total: $1,299.99\r\n`,
  );
  await expect(page.getByText(/bestbuy\.com · Added/)).toBeVisible({ timeout: 15_000 });
});
