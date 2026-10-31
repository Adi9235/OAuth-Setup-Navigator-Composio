import { describe, expect, it } from "vitest";
import { credentialsPayload, EMPTY_SETTINGS, effectiveSetup, type ServerConfig } from "./api-settings";

const server = (keys: Partial<ServerConfig["keys"]> = {}): ServerConfig => ({
  llm: { provider: "groq", model: "openai/gpt-oss-120b", keyName: "GROQ_API_KEY", keySet: !!keys.groq },
  search: { keySet: !!keys.tavily },
  canGenerate: !!keys.groq && !!keys.tavily,
  keys: { groq: false, anthropic: false, tavily: false, ...keys },
});

describe("effectiveSetup", () => {
  it("uses the server's keys when the visitor saved none", () => {
    expect(effectiveSetup(null, server({ groq: true, tavily: true }))).toMatchObject({
      provider: "groq", model: "openai/gpt-oss-120b", llmKey: "server", searchKey: "server", canGenerate: true,
    });
  });

  it("asks for keys when neither side has them", () => {
    expect(effectiveSetup(null, server())).toMatchObject({ llmKey: "missing", searchKey: "missing", canGenerate: false });
  });

  it("visitor's provider, model and keys win", () => {
    const s = { ...EMPTY_SETTINGS, provider: "anthropic" as const, anthropicKey: "sk-ant-x", model: "claude-opus-5-5" };
    expect(effectiveSetup(s, server({ groq: true, tavily: true }))).toMatchObject({
      provider: "anthropic", model: "claude-opus-5-5", llmKey: "yours", searchKey: "server", canGenerate: true,
    });
  });

  it("switching to a provider the server has no key for needs the visitor's key", () => {
    const s = { ...EMPTY_SETTINGS, provider: "anthropic" as const };
    expect(effectiveSetup(s, server({ groq: true, tavily: true }))).toMatchObject({ llmKey: "missing", canGenerate: false, model: "claude-sonnet-5-5" });
  });
});

describe("credentialsPayload", () => {
  it("sends only filled-in fields", () => {
    expect(credentialsPayload({ ...EMPTY_SETTINGS, groqKey: " gsk_1 ", tavilyKey: "" })).toEqual({
      provider: "groq", model: undefined, groqKey: "gsk_1", anthropicKey: undefined, tavilyKey: undefined,
    });
    expect(credentialsPayload(null)).toBeUndefined();
  });
});
