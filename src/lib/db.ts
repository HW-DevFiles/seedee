import "server-only";
import { createDatabase } from "./db-client";

const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof createDatabase>;
};

export const db =
  globalForDb.db ??
  createDatabase(process.env.DATABASE_URL ?? "file:./prisma/dev.db");
if (process.env.NODE_ENV !== "production") globalForDb.db = db;
