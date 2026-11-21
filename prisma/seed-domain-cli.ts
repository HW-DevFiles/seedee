import "dotenv/config";
import { createDatabase } from "../src/lib/db-client";
import { initializeSyntheticWorkspace } from "./seed-domain";
const db = createDatabase(process.env.DATABASE_URL ?? "file:./prisma/dev.db");
try {
  await initializeSyntheticWorkspace(db, new Date());
  console.log("Synthetic domain fixture ready; existing records preserved.");
} catch {
  console.error(
    "Domain seed refused. Use the reserved local fixture identity on a migrated nonproduction database.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
