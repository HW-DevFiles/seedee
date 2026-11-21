import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

// Also used by seed/tests; application imports should use the server-only db.ts.
export function createDatabase(url: string) {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
