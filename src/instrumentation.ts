export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readEnvironment } = await import("./lib/env");
    const env = readEnvironment();
    if (env.NODE_ENV === "production") {
      const { db } = await import("./lib/db");
      const { assertRuntimeSafety } = await import("./lib/runtime-safety");
      try {
        await assertRuntimeSafety(db, env);
      } catch (error) {
        // Next only logs instrumentation errors and keeps serving; refuse to run instead.
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    }
  }
}
