import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword, verifyPassword } from "./password";
import { hashToken, issueToken } from "./tokens";
import { credentialsSchema, signUpSchema } from "./validation";

export const AUTH_LIMIT = 10;
export const IP_AUTH_LIMIT = 50;
export const AUTH_WINDOW_MS = 15 * 60 * 1000;
const publicUser = { id: true, name: true, email: true } as const;
// Equal-cost work for an unknown email; computed once per server process.
const dummyHash = hashPassword("seedee-dummy-account-not-a-login");

export class AuthError extends Error {}

function throttleKeys(email: string, clientIp: string) {
  const ip = clientIp.trim() || "unknown";
  return {
    account: hashToken(`account:${email.trim().toLowerCase()}|${ip}`),
    ip: hashToken(`ip:${ip}`),
  };
}

async function countAttempt(db: PrismaClient, key: string, now: Date) {
  await db.authThrottle.deleteMany({ where: { key, expiresAt: { lte: now } } });
  const attempt = await db.authThrottle.upsert({
    where: { key },
    create: { key, expiresAt: new Date(now.getTime() + AUTH_WINDOW_MS) },
    update: { attempts: { increment: 1 } },
  });
  return attempt.attempts;
}

export async function consumeAuthAttempt(
  db: PrismaClient,
  email: string,
  clientIp: string,
  now = new Date(),
) {
  const keys = throttleKeys(email, clientIp);
  const accountAttempts = await countAttempt(db, keys.account, now);
  const ipAttempts = await countAttempt(db, keys.ip, now);
  if (accountAttempts > AUTH_LIMIT || ipAttempts > IP_AUTH_LIMIT)
    throw new AuthError("Too many attempts. Try again in 15 minutes.");
}

export async function clearAuthAttempts(
  db: PrismaClient,
  email: string,
  clientIp: string,
) {
  const keys = throttleKeys(email, clientIp);
  await db.authThrottle.deleteMany({ where: { key: keys.account } });
  await db.authThrottle.updateMany({
    where: { key: keys.ip, attempts: { gt: 0 } },
    data: { attempts: { decrement: 1 } },
  });
}

export async function registerUser(
  db: PrismaClient,
  input: unknown,
  clientIp: string,
) {
  const parsed = signUpSchema.parse(input);
  await consumeAuthAttempt(db, parsed.email, clientIp);
  const passwordHash = await hashPassword(parsed.password);
  try {
    const user = await db.user.create({
      data: { name: parsed.name, email: parsed.email, passwordHash },
      select: publicUser,
    });
    await clearAuthAttempts(db, parsed.email, clientIp);
    return user;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new AuthError(
        "Unable to create an account with those details. Try signing in.",
      );
    }
    throw error;
  }
}

export async function authenticateUser(
  db: PrismaClient,
  input: unknown,
  clientIp: string,
) {
  const parsed = credentialsSchema.parse(input);
  await consumeAuthAttempt(db, parsed.email, clientIp);
  const user = await db.user.findUnique({ where: { email: parsed.email } });
  const valid = await verifyPassword(
    parsed.password,
    user?.passwordHash ?? (await dummyHash),
  );
  if (!user || !valid) throw new AuthError("Email or password is incorrect.");
  await clearAuthAttempts(db, parsed.email, clientIp);
  return { id: user.id, name: user.name, email: user.email };
}

export async function createSession(
  db: PrismaClient,
  userId: string,
  now = new Date(),
) {
  const issued = issueToken(now);
  await db.session.deleteMany({ where: { userId, expiresAt: { lte: now } } });
  await db.session.create({
    data: { userId, tokenHash: issued.tokenHash, expiresAt: issued.expiresAt },
  });
  return { token: issued.token, expiresAt: issued.expiresAt };
}

export async function findSessionUser(
  db: PrismaClient,
  token: string,
  now = new Date(),
) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, user: { select: publicUser } },
  });
  if (!session || session.expiresAt <= now) return null;
  return session.user;
}

export async function revokeSession(db: PrismaClient, token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
