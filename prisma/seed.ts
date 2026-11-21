import "dotenv/config";
import { createDatabase } from "../src/lib/db-client";
import { readEnvironment } from "../src/lib/env";
import { initializeSyntheticWorkspace } from "./seed-domain";
import { seedLocalDemo } from "../src/lib/local-demo";

async function main() {
  const env = readEnvironment();
  const db = createDatabase(env.DATABASE_URL);
  try {
    await seedLocalDemo(db, env);
    await initializeSyntheticWorkspace(db, new Date());
    console.log(
      "Synthetic local sample is ready. Existing records were preserved.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Demo seed refused or failed. Check local configuration and reserved fixture identity; no credentials are logged.",
  );
  process.exitCode = 1;
});
