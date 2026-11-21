import "server-only";
import { compare } from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { demoFixture } from "./demo-fixture";
import type { Environment } from "./env";

// Configuration cannot remove a public password from an already-seeded database.
export async function assertRuntimeSafety(db: PrismaClient, env: Environment) {
  if (env.NODE_ENV !== "production") return;
  const user = await db.user.findUnique({
    where: { email: demoFixture.email },
    select: { passwordHash: true },
  });
  if (user && (await compare(demoFixture.password, user.passwordHash))) {
    throw new Error(
      "Production cannot start with the public demo login enabled in its database.",
    );
  }
}
