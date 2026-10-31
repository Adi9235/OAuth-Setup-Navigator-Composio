import { describe, expect, it } from "vitest";
import { sampleGuide } from "@/test/fixtures";
import { formatDays, formatMinutes, relativeTime } from "./format";
import { guideToMarkdown } from "./markdown-export";

describe("format", () => {
  it("formats minute ranges, switching to hours from 2h", () => {
    expect(formatMinutes({ min: 15, max: 30 })).toBe("15–30 min");
    expect(formatMinutes({ min: 60, max: 120 })).toBe("1–2 h");
    expect(formatMinutes({ min: 120, max: 360 })).toBe("2–6 h");
  });

  it("formats approval waits", () => {
    expect(formatDays({ min: 0, max: 0 })).toBe("No review");
    expect(formatDays({ min: 1, max: 30 })).toBe("1–30 days");
    expect(formatDays({ min: 1, max: 1 })).toBe("1 day");
  });

  it("relativeTime", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(relativeTime("2026-10-31T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-28T12:00:00Z", now)).toBe("3 days ago");
    expect(relativeTime("2026-10-31T11:00:00Z", now)).toBe("1 hour ago");
  });
});

describe("guideToMarkdown", () => {
  it("includes summary, evidence tags, steps and sources", () => {
    const md = guideToMarkdown(sampleGuide(), { versionNo: 2 });
    expect(md).toContain("# Example App — OAuth app setup guide");
    expect(md).toContain("| **easy** | 10–30 min | No review | high |");
    expect(md).toContain("**Create the OAuth app** (You)");
    expect(md).toContain("*[Tested: developer_console pass]*");
    expect(md).toContain("*[Sourced: [1](https://example.com/docs/oauth)]*");
    expect(md).toContain("version 2");
  });
});
