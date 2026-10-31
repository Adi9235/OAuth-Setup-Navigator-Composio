// Node-only boot: register job handlers and start the in-process runner.
import { registerAllHandlers } from "./server/jobs/handlers";
import { startRunner } from "./server/jobs/runner";

registerAllHandlers();
startRunner();
