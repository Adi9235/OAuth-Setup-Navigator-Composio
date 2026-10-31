// Wires job types to their handlers. Imported once at boot by instrumentation-node.ts.
import { fakePipeline } from "../agent/fake-pipeline";
import { generatePipeline } from "../agent/pipeline";
import { registerHandler, type JobHandler } from "./runner";

const generate: JobHandler = async (ctx) =>
  /^fake:/i.test(ctx.job.input_text) ? fakePipeline(ctx) : generatePipeline(ctx);

export function registerAllHandlers() {
  registerHandler("generate", generate);
}
