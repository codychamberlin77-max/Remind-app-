import { describe, expect, it } from "vitest";
import { newPkce, signState, verifyState } from "@/server/mail/oauthState";

describe("mail OAuth state", () => {
  const { verifier, challenge } = newPkce();
  const state = signState({ userId: "u1", provider: "gmail", verifier }, 1_000_000);

  it("uses a proper S256 PKCE challenge", () => {
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });

  it("accepts only the same user, provider and browser, within 10 minutes", () => {
    expect(verifyState(state, { userId: "u1", provider: "gmail", verifier }, 1_000_000 + 60_000)).toBe(true);
    expect(verifyState(state, { userId: "u2", provider: "gmail", verifier }, 1_000_000)).toBe(false);
    expect(verifyState(state, { userId: "u1", provider: "outlook", verifier }, 1_000_000)).toBe(false);
    expect(verifyState(state, { userId: "u1", provider: "gmail", verifier: newPkce().verifier }, 1_000_000)).toBe(false);
    expect(verifyState(state, { userId: "u1", provider: "gmail", verifier: undefined }, 1_000_000)).toBe(false);
    expect(verifyState(state, { userId: "u1", provider: "gmail", verifier }, 1_000_000 + 11 * 60_000)).toBe(false);
    const [p, s] = state.split(".");
    expect(verifyState(`${p}x.${s}`, { userId: "u1", provider: "gmail", verifier }, 1_000_000)).toBe(false);
  });
});
