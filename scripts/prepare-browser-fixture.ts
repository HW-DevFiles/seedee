import { createDatabase } from "../src/lib/db-client";
import { readEnvironment } from "../src/lib/env";
import { seedLocalDemo } from "../src/lib/local-demo";
import { demoFixture } from "../src/lib/demo-fixture";
import { hashPassword } from "../src/lib/auth/password";
import { initializeSyntheticWorkspace } from "../prisma/seed-domain";

// Only the explicitly selected Playwright database is eligible. Rotate the
// synthetic credential before starting Next; production's public-login guard
// remains enabled and the ordinary local seed remains unchanged.
const databaseUrl = process.env.E2E_DATABASE_URL;
const password = process.env.E2E_SAMPLE_PASSWORD;
if (!databaseUrl || databaseUrl !== process.env.DATABASE_URL || !password)
  throw new Error("Playwright fixture configuration is required.");
const env = readEnvironment({
  ...process.env,
  NODE_ENV: "development",
  DEMO_ACCOUNT_ENABLED: "true",
});
const db = createDatabase(databaseUrl);
try {
  await seedLocalDemo(db, env);
  await initializeSyntheticWorkspace(db, new Date());
  await db.user.update({
    where: { id: demoFixture.userId },
    data: { passwordHash: await hashPassword(password) },
  });
} finally {
  await db.$disconnect();
}
