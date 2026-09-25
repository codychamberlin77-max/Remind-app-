import { describe, expect, it } from "vitest";
import { decryptField, encryptField } from "@/server/privacy/crypto";

describe("field encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptField("DL-ABC123");
    const b = encryptField("DL-ABC123");
    expect(a.equals(b)).toBe(false);
    expect(decryptField(a)).toBe("DL-ABC123");
  });
  it("detects tampering", () => {
    const blob = encryptField("secret");
    blob[blob.length - 1]! ^= 0xff;
    expect(() => decryptField(blob)).toThrow();
  });
});
