// Next.js boot hook. The NEXT_RUNTIME check must wrap the import so the edge bundle drops it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
