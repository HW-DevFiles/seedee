import "dotenv/config";
import { createDatabase } from "../src/lib/db-client";
import { readEnvironment } from "../src/lib/env";
import { resetLocalDemo } from "../src/lib/local-demo";

async function main() {
  const env = readEnvironment();
  const db = createDatabase(env.DATABASE_URL);
  try {
    await resetLocalDemo(
      db,
      env,
      process.argv.slice(2).join(" ") === "--confirm-reset-synthetic-demo",
    );
    console.log(
      "Reserved local sample removed (or already absent). Run db:seed to recreate it.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Reset refused or failed. Requires nonproduction demo mode, --confirm-reset-synthetic-demo, and unchanged reserved sample identity/profile.",
  );
  process.exitCode = 1;
});
