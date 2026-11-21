import "dotenv/config";
import { createDatabase } from "../src/lib/db-client";
import { hashPassword } from "../src/lib/auth/password";
import { demoAgencyId, demoEmail, demoUserId } from "./demo-identity";

const db = createDatabase(process.env.DATABASE_URL ?? "file:./prisma/dev.db");

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production.");
  const passwordHash = await hashPassword("SeedeeDemo!2026");
  await db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: demoEmail } }),
      reserved = await tx.agency.findUnique({ where: { id: demoAgencyId } });
    if (
      (existing && existing.id !== demoUserId) ||
      (reserved && reserved.ownerId !== demoUserId)
    )
      throw new Error("Demo identity is held by another account.");
    await tx.user.upsert({
      where: { email: demoEmail },
      update: {},
      create: {
        id: demoUserId,
        name: "Alex Creative",
        email: demoEmail,
        passwordHash,
      },
    });
    await tx.agency.upsert({
      where: { ownerId: demoUserId },
      update: {},
      create: {
        id: demoAgencyId,
        name: "Fieldwork Studio",
        description:
          "A fictional brand and digital design studio. Sample data for exploring Seedee.",
        ownerId: demoUserId,
      },
    });
  });
  console.log(
    "Demo account and sample agency are ready. See README for local login details.",
  );
}

main()
  .catch(() => {
    console.error("Demo seed failed. Check the local database configuration.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
