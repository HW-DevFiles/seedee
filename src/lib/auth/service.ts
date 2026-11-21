import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { demoFixture } from "@/lib/demo-fixture";
import { hashPassword, verifyPassword } from "./password";
import { hashToken, issueToken } from "./tokens";
import { credentialsSchema, signUpSchema } from "./validation";

export const AUTH_LIMIT = 10;
export const IP_AUTH_LIMIT = 50;
export const ACCOUNT_AUTH_LIMIT = 30;
export const AUTH_WINDOW_MS = 15 * 60 * 1000;
const publicUser = { id: true, name: true, email: true } as const;
// Equal-cost work for an unknown email; computed once per server process.
const dummyHash = hashPassword("seedee-dummy-account-not-a-login");
const signUpRefused =
  "Unable to create an account with those details. Try signing in.";

export class AuthError extends Error {}

function throttleKeys(email: string, clientIp: string | null) {
  const account = email.trim().toLowerCase();
  return {
    account: hashToken(`email:${account}`),
    accountIp: clientIp ? hashToken(`account:${account}|${clientIp}`) : null,
    ip: clientIp ? hashToken(`ip:${clientIp}`) : null,
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

async function uncountAttempt(db: PrismaClient, key: string) {
  await db.authThrottle.updateMany({
    where: { key, attempts: { gt: 0 } },
    data: { attempts: { decrement: 1 } },
  });
}

export async function consumeAuthAttempt(
  db: PrismaClient,
  email: string,
  clientIp: string | null,
  now = new Date(),
) {
  const keys = throttleKeys(email, clientIp);
  let limited =
    (await countAttempt(db, keys.account, now)) > ACCOUNT_AUTH_LIMIT;
  if (keys.accountIp && keys.ip) {
    if ((await countAttempt(db, keys.accountIp, now)) > AUTH_LIMIT)
      limited = true;
    if ((await countAttempt(db, keys.ip, now)) > IP_AUTH_LIMIT) limited = true;
  }
  if (limited)
    throw new AuthError("Too many attempts. Try again in 15 minutes.");
}

export async function clearAuthAttempts(
  db: PrismaClient,
  email: string,
  clientIp: string | null,
) {
  const keys = throttleKeys(email, clientIp);
  await uncountAttempt(db, keys.account);
  if (keys.accountIp && keys.ip) {
    await db.authThrottle.deleteMany({ where: { key: keys.accountIp } });
    await uncountAttempt(db, keys.ip);
  }
}

export async function registerUser(
  db: PrismaClient,
  input: unknown,
  clientIp: string | null,
) {
  const parsed = signUpSchema.parse(input);
  await consumeAuthAttempt(db, parsed.email, clientIp);
  if (parsed.email === demoFixture.email) throw new AuthError(signUpRefused);
  const passwordHash = await hashPassword(parsed.password);
  try {
    return await db.user.create({
      data: { name: parsed.name, email: parsed.email, passwordHash },
      select: publicUser,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new AuthError(signUpRefused);
    }
    throw error;
  }
}

export async function authenticateUser(
  db: PrismaClient,
  input: unknown,
  clientIp: string | null,
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
