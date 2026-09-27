/**
 * Cloudflare Email Worker: receives mail for *@<your inbound domain> via Email
 * Routing (catch-all rule → this Worker) and relays the raw message to LIFEOS.
 *
 * Secrets / vars (set with `wrangler secret put` / wrangler.toml):
 *   LIFEOS_INBOUND_URL    e.g. https://your-app.up.railway.app/api/inbound/email
 *   INBOUND_EMAIL_SECRET  same value as the app's INBOUND_EMAIL_SECRET
 */
const worker = {
  async email(message, env) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const to = message.to.toLowerCase();

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.INBOUND_EMAIL_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const prefix = new TextEncoder().encode(`${timestamp}.${to}.`);
    const signed = new Uint8Array(prefix.length + raw.length);
    signed.set(prefix, 0);
    signed.set(raw, prefix.length);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, signed))].map((b) => b.toString(16).padStart(2, "0")).join("");

    const res = await fetch(env.LIFEOS_INBOUND_URL, {
      method: "POST",
      headers: { "content-type": "message/rfc822", "x-lifeos-timestamp": timestamp, "x-lifeos-signature": sig, "x-lifeos-to": to },
      body: raw,
    });
    if (res.status === 404) {
      message.setReject("Unknown recipient");
      return;
    }
    if (res.status >= 400 && res.status < 500) {
      message.setReject("Message not accepted");
      return;
    }
    if (!res.ok) throw new Error(`LIFEOS inbound failed: ${res.status}`); // temporary failure → sender retries
  },
};

export default worker;
