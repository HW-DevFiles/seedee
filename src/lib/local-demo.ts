import { compare } from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "./auth/password";
import { demoFixture as fixture } from "./demo-fixture";
import type { Environment } from "./env";

function assertLocalDemo(env: Environment) {
  if (env.NODE_ENV === "production" || !env.DEMO_ACCOUNT_ENABLED) {
    throw new Error(
      "Local demo tooling requires nonproduction mode and DEMO_ACCOUNT_ENABLED=true.",
    );
  }
}

export async function seedLocalDemo(db: PrismaClient, env: Environment) {
  assertLocalDemo(env);
  const passwordHash = await hashPassword(fixture.password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: fixture.email } });
    const reserved = await tx.user.findUnique({
      where: { id: fixture.userId },
    });
    if (
      (user && user.id !== fixture.userId) ||
      (reserved && reserved.email !== fixture.email)
    ) {
      throw new Error(
        "Reserved demo identity is already in use; no data was changed. Use a fresh local database.",
      );
    }
    await tx.user.upsert({
      where: { id: fixture.userId },
      update: {},
      create: {
        id: fixture.userId,
        email: fixture.email,
        name: fixture.name,
        passwordHash,
      },
    });
    await tx.agency.upsert({
      where: { ownerId: fixture.userId },
      update: {},
      create: {
        id: fixture.agencyId,
        ownerId: fixture.userId,
        name: fixture.agencyName,
        description: fixture.agencyDescription,
      },
    });
    return { fixtureVersion: fixture.version, userId: fixture.userId };
  });
}

// Explicit local CLI only. No submitted target ID or whole-database reset.
export async function resetLocalDemo(
  db: PrismaClient,
  env: Environment,
  confirmed: boolean,
) {
  assertLocalDemo(env);
  if (!confirmed)
    throw new Error(
      "Pass --confirm-reset-synthetic-demo to reset the reserved local sample.",
    );
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: fixture.userId },
      include: { agency: true },
    });
    if (!user) return { deleted: false };
    if (
      user.email !== fixture.email ||
      user.name !== fixture.name ||
      !(await compare(fixture.password, user.passwordHash)) ||
      (user.agency &&
        (user.agency.id !== fixture.agencyId ||
          user.agency.name !== fixture.agencyName ||
          user.agency.description !== fixture.agencyDescription))
    ) {
      throw new Error(
        "The reserved sample identity or profile changed; reset refused without deleting data.",
      );
    }
    await tx.user.delete({ where: { id: fixture.userId } });
    return { deleted: true };
  });
}
