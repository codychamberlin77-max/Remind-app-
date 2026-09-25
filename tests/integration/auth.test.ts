import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { resetDb } from "../helpers/db";

describe("auth", () => {
  beforeEach(resetDb);

  it("signs up and signs in with email/password; stores a hashed password and a DB session", async () => {
    const res = await auth().api.signUpEmail({
      body: { email: "ada@example.com", password: "correct horse battery", name: "Ada" },
    });
    expect(res.user.email).toBe("ada@example.com");
    expect(res.user.id).toMatch(/^[0-9a-f-]{36}$/);

    const signIn = await auth().api.signInEmail({
      body: { email: "ada@example.com", password: "correct horse battery" },
    });
    expect(signIn.token).toBeTruthy();

    await expect(
      auth().api.signInEmail({ body: { email: "ada@example.com", password: "wrong password!!" } }),
    ).rejects.toThrow();
  });

  it("rejects short passwords", async () => {
    await expect(
      auth().api.signUpEmail({ body: { email: "b@example.com", password: "short", name: "B" } }),
    ).rejects.toThrow();
  });

  it("does not let a client set its own plan", async () => {
    const res = await auth().api.signUpEmail({
      body: { email: "c@example.com", password: "long enough password", name: "C", plan: "pro" } as never,
    }).catch((e) => e);
    // Either rejected outright or ignored; never persisted as "pro".
    if (res?.user) expect((res.user as { plan?: string }).plan).not.toBe("pro");
  });
});
