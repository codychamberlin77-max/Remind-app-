import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/server/env";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

function appUrl(value: string | undefined, railwayDomain?: string) {
  if (value === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = value;
  if (railwayDomain) process.env.RAILWAY_PUBLIC_DOMAIN = railwayDomain;
  else delete process.env.RAILWAY_PUBLIC_DOMAIN;
  resetEnvCache();
  return env().APP_URL;
}

describe("APP_URL is forgiving of dashboard typos", () => {
  it("normalizes common mistakes", () => {
    expect(appUrl("https://lifeos.up.railway.app")).toBe("https://lifeos.up.railway.app");
    expect(appUrl("lifeos.up.railway.app")).toBe("https://lifeos.up.railway.app");
    expect(appUrl(' "https://lifeos.up.railway.app/" ')).toBe("https://lifeos.up.railway.app");
  });
  it("falls back to the platform domain when APP_URL is unusable", () => {
    expect(appUrl("https://", "remind-app-production.up.railway.app")).toBe("https://remind-app-production.up.railway.app");
    expect(appUrl("https://${{web.RAILWAY_PUBLIC_DOMAIN}}", "x.up.railway.app")).toBe("https://x.up.railway.app");
    expect(appUrl(undefined, "x.up.railway.app")).toBe("https://x.up.railway.app");
  });
  it("still rejects garbage when there is no fallback", () => {
    expect(() => appUrl("https://")).toThrow(/APP_URL/);
  });
});
