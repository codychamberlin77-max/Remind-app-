import { schema, type Tx } from "@/server/db/client";
import type { ReminderChannel } from "@/server/domain/types";
import { env } from "@/server/env";

export type Delivery = {
  userId: string;
  email: string | null;
  name: string | null;
  reminderId: string;
  actionId: string;
  itemId: string;
  title: string;
  body: string;
};

/**
 * Reminder channels share one interface. In-app and email are live; push and
 * SMS are declared so they can be added without touching the scheduler.
 */
export interface ReminderChannelAdapter {
  id: ReminderChannel;
  send(tx: Tx, d: Delivery): Promise<void>;
}

const inApp: ReminderChannelAdapter = {
  id: "in_app",
  async send(tx, d) {
    await tx.insert(schema.notifications).values({
      userId: d.userId,
      reminderId: d.reminderId,
      actionId: d.actionId,
      channel: "in_app",
      title: d.title,
      body: d.body,
      deliveredAt: new Date(),
    });
  },
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderReminderEmail(d: Delivery, appUrl: string) {
  const link = `${appUrl}/items/${d.itemId}`;
  const text = `${d.title}\n\n${d.body}\n\nOpen: ${link}\n\nYou're receiving this because you set a reminder in LIFEOS. Manage reminders in Settings.`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;background:#fafafa;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:14px;padding:24px">
<p style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#888;margin:0 0 12px">Reminder</p>
<h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(d.title)}</h1>
<p style="font-size:15px;line-height:1.5;color:#333;margin:0 0 20px">${escapeHtml(d.body)}</p>
<a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px">Open</a>
<p style="font-size:12px;color:#999;margin:24px 0 0">You set this reminder in LIFEOS. Manage reminders in Settings.</p>
</div></body></html>`;
  return { subject: d.title, text, html };
}

const email: ReminderChannelAdapter = {
  id: "email",
  async send(tx, d) {
    if (!d.email) throw new Error("no email address");
    const e = env();
    const msg = renderReminderEmail(d, e.APP_URL);
    if (e.EMAIL_DRIVER === "resend") {
      if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [d.email], subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
    } else if (e.NODE_ENV !== "test") {
      console.info(`[email:log] to=<user ${d.userId}> subject="${msg.subject}"`);
    }
    await tx.insert(schema.notifications).values({
      userId: d.userId,
      reminderId: d.reminderId,
      actionId: d.actionId,
      channel: "email",
      title: d.title,
      body: d.body,
      deliveredAt: new Date(),
    });
  },
};

const notYet = (id: ReminderChannel): ReminderChannelAdapter => ({
  id,
  async send() {
    throw new Error(`${id} delivery is not available yet`);
  },
});

const CHANNELS: Record<ReminderChannel, ReminderChannelAdapter> = {
  in_app: inApp,
  email,
  push: notYet("push"),
  sms: notYet("sms"),
};

export function getChannel(id: ReminderChannel): ReminderChannelAdapter {
  return CHANNELS[id];
}
