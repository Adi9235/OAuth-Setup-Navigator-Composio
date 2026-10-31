import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows `limit` hits per window per key", () => {
    const rl = createRateLimiter(5, 10_000);
    for (let i = 0; i < 5; i++) expect(rl.check("a", 1000 + i)).toBe(true);
    expect(rl.check("a", 1010)).toBe(false);
    expect(rl.check("b", 1010)).toBe(true);
    expect(rl.check("a", 1000 + 10_001)).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
