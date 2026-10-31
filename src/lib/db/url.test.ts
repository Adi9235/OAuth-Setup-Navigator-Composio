import { describe, expect, it } from "vitest";
import { normalizeDatabaseUrl } from "./url";

const URL_OK = "postgresql://user:p%40ss@ep-x.neon.tech/neondb?sslmode=require";

describe("normalizeDatabaseUrl", () => {
  it("accepts a plain URL", () => {
    expect(normalizeDatabaseUrl(URL_OK)).toBe(URL_OK);
    expect(normalizeDatabaseUrl("postgres://u:p@localhost:5432/db")).toBe("postgres://u:p@localhost:5432/db");
  });

  it("strips quotes, whitespace, a DATABASE_URL= prefix and Neon's psql wrapper", () => {
    expect(normalizeDatabaseUrl(`"${URL_OK}"`)).toBe(URL_OK);
    expect(normalizeDatabaseUrl(`  '${URL_OK}'  `)).toBe(URL_OK);
    expect(normalizeDatabaseUrl(`DATABASE_URL="${URL_OK}"`)).toBe(URL_OK);
    expect(normalizeDatabaseUrl(`psql '${URL_OK}'`)).toBe(URL_OK);
  });

  it("rejects non-Postgres values without echoing them", () => {
    expect(() => normalizeDatabaseUrl("")).toThrow("DATABASE_URL is not set");
    expect(() => normalizeDatabaseUrl("ep-x.neon.tech/neondb")).toThrow(/must start with postgresql:\/\//);
    try {
      normalizeDatabaseUrl("secret-value-here");
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-value-here");
    }
  });
});
