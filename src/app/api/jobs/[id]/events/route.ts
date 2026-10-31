// SSE: replay every stored job_event, then tail new rows every 500ms (tracking last id),
// heartbeat every 15s, close once the job is terminal and drained.
import { isTerminal } from "@/lib/api-types";
import { getJob, listJobEvents } from "@/lib/db/jobs";
import { toJobEvent } from "@/server/jobs/events";
import { UUID } from "@/server/http";
import { toJobSummary } from "@/server/resolve";

export const dynamic = "force-dynamic";

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = UUID.test(id) ? await getJob(id) : null;
  if (!job) return new Response("Job not found", { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  req.signal.addEventListener("abort", () => (closed = true));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      let lastId = "0";
      let lastBeat = Date.now();
      send(`retry: 2000\n\n`);
      try {
        while (!closed) {
          const rows = await listJobEvents(id, lastId);
          for (const row of rows) {
            lastId = String(row.id);
            send(`id: ${lastId}\nevent: job_event\ndata: ${JSON.stringify(toJobEvent(row))}\n\n`);
          }
          const current = await getJob(id);
          if (!current || isTerminal(current.status)) {
            // Drain anything written between the two queries, then finish.
            for (const row of await listJobEvents(id, lastId)) {
              lastId = String(row.id);
              send(`id: ${lastId}\nevent: job_event\ndata: ${JSON.stringify(toJobEvent(row))}\n\n`);
            }
            if (current) send(`event: end\ndata: ${JSON.stringify(toJobSummary(current))}\n\n`);
            break;
          }
          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            send(`: heartbeat\n\n`);
            lastBeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (err) {
        send(`event: stream_error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : "error" })}\n\n`);
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
