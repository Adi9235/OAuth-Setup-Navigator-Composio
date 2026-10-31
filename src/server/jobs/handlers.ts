// Wires job types to their handlers. Imported once at boot by instrumentation.ts.
import { fakePipeline } from "../agent/fake-pipeline";
import { registerHandler, type JobHandler } from "./runner";

const generate: JobHandler = async (ctx) => {
  if (/^fake:/i.test(ctx.job.input_text)) return fakePipeline(ctx);
  throw new Error("The agent pipeline is not implemented yet (M3)");
};

export function registerAllHandlers() {
  registerHandler("generate", generate);
}
