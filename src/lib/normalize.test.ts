import { describe, expect, it } from "vitest";
import { jobDedupeKey, normalizeInput, registrableDomain, slugify } from "./normalize";

describe("normalizeInput", () => {
  it("resolves github / GitHub.com / docs URL to the same app identity", () => {
    expect(normalizeInput("github")).toMatchObject({ kind: "name", slug: "github" });
    expect(normalizeInput("GitHub.com")).toMatchObject({ kind: "domain", domain: "github.com", slug: "github" });
    expect(normalizeInput("https://docs.github.com/en/apps")).toMatchObject({ domain: "github.com" });
    expect(normalizeInput("https://github.com/settings")).toMatchObject({ domain: "github.com" });
  });

  it("strips www and developer prefixes down to the registrable domain", () => {
    expect(normalizeInput("www.notion.so")).toMatchObject({ domain: "notion.so", slug: "notion" });
    expect(normalizeInput("developers.google.com/gmail")).toMatchObject({ domain: "google.com" });
    expect(normalizeInput("api.slack.com")).toMatchObject({ domain: "slack.com" });
  });

  it("trims and lowercases bare names", () => {
    expect(normalizeInput("   Slack  ")).toMatchObject({ kind: "name", name: "Slack", slug: "slack" });
    expect(normalizeInput("Google  Drive")).toMatchObject({ kind: "name", slug: "google-drive" });
  });

  it("rejects empty, overlong, and implausible input", () => {
    expect(normalizeInput("")).toBeNull();
    expect(normalizeInput("   ")).toBeNull();
    expect(normalizeInput("a".repeat(201))).toBeNull();
    expect(normalizeInput("<script>alert(1)</script>")).toBeNull();
    expect(normalizeInput("https://localhost")).toBeNull();
  });

  it("treats dotted names without a real TLD as names", () => {
    expect(normalizeInput("Next.js")).toMatchObject({ kind: "name", slug: "next-js" });
  });
});

describe("helpers", () => {
  it("slugify", () => {
    expect(slugify("Google (Workspace APIs)")).toBe("google-workspace-apis");
    expect(slugify("Café Notes")).toBe("cafe-notes");
  });

  it("registrableDomain handles subdomains and multi-part TLDs", () => {
    expect(registrableDomain("https://accounts.google.com/o/oauth2")).toBe("google.com");
    expect(registrableDomain("app.example.co.uk")).toBe("example.co.uk");
  });

  it("jobDedupeKey uses domain, or a provisional name key", () => {
    expect(jobDedupeKey(normalizeInput("zoom.us")!)).toBe("zoom.us");
    expect(jobDedupeKey(normalizeInput("Airtable")!)).toBe("name:airtable");
  });
});
