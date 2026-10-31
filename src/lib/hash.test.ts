import { describe, expect, it } from "vitest";
import { createLimiter } from "./limit";
import { contentHash, normalizeText } from "./hash";

describe("contentHash", () => {
  it("is a stable sha256 hex digest", () => {
    expect(contentHash("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash("hello")).toBe(contentHash("hello"));
  });

  it("ignores whitespace-only differences but detects text changes", () => {
    expect(contentHash("Review takes  7 days\n")).toBe(contentHash(" Review takes 7 days"));
    expect(contentHash("Review takes 7 days")).not.toBe(contentHash("Review takes 14 days"));
    expect(normalizeText("a \n\t b")).toBe("a b");
  });
});

describe("createLimiter", () => {
  it("never runs more than max tasks at once", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBe(3);
  });

  it("propagates rejections", async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
