import "server-only";
import { createDatabase } from "./db-client";
import { readEnvironment } from "./env";

const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof createDatabase>;
};

export const db =
  globalForDb.db ?? createDatabase(readEnvironment().DATABASE_URL);
if (process.env.NODE_ENV !== "production") globalForDb.db = db;
