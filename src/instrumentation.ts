export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readEnvironment } = await import("./lib/env");
    const env = readEnvironment();
    if (env.NODE_ENV === "production") {
      const { db } = await import("./lib/db");
      const { assertRuntimeSafety } = await import("./lib/runtime-safety");
      await assertRuntimeSafety(db, env);
    }
  }
}
