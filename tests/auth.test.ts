import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import {
  authenticateUser,
  AUTH_LIMIT,
  AUTH_WINDOW_MS,
  consumeAuthAttempt,
  createSession,
  findSessionUser,
  registerUser,
  revokeSession,
} from "@/lib/auth/service";
import {
  hashToken,
  SESSION_DURATION_MS,
  sessionCookieOptions,
} from "@/lib/auth/tokens";
import { credentialsSchema } from "@/lib/auth/validation";

const directory = mkdtempSync(join(tmpdir(), "seedee-auth-"));
const url = `file:${join(directory, "test.db")}`;
const db = createDatabase(url);
const credentials = {
  name: "Test Creative",
  email: "creative@example.test",
  password: "A long test password!",
};

beforeAll(() => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    },
  );
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe("account and session boundary", () => {
  it("normalizes email, hashes passwords, rejects duplicates and does not create an agency", async () => {
    const user = await registerUser(db, {
      ...credentials,
      email: "  CREATIVE@example.test ",
    });
    expect(user.email).toBe(credentials.email);
    expect(user).not.toHaveProperty("passwordHash");
    const stored = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { agency: true },
    });
    expect(stored.passwordHash).not.toEqual(credentials.password);
    expect(stored.agency).toBeNull();
    await expect(registerUser(db, credentials)).rejects.toThrow(
      "Unable to create an account",
    );
  });

  it("authenticates the password and uses the same error for unknown accounts and wrong passwords", async () => {
    const user = await authenticateUser(db, credentials);
    expect(user.email).toBe(credentials.email);
    await expect(
      authenticateUser(db, {
        ...credentials,
        password: "Definitely not correct",
      }),
    ).rejects.toThrow("Email or password is incorrect.");
    await expect(
      authenticateUser(db, { ...credentials, email: "unknown@example.test" }),
    ).rejects.toThrow("Email or password is incorrect.");
  });

  it("stores only token hashes and rejects expired, forged, and revoked sessions", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { email: credentials.email },
    });
    const now = new Date("2026-01-01T00:00:00Z");
    const session = await createSession(db, user.id, now);
    const stored = await db.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(session.token) },
    });
    expect(stored.tokenHash).not.toEqual(session.token);
    expect(await findSessionUser(db, session.token, now)).toMatchObject({
      id: user.id,
    });
    expect(await findSessionUser(db, "f".repeat(64), now)).toBeNull();
    expect(await findSessionUser(db, "malformed", now)).toBeNull();
    expect(
      await findSessionUser(
        db,
        session.token,
        new Date(now.getTime() + SESSION_DURATION_MS),
      ),
    ).toBeNull();
    await revokeSession(db, session.token);
    expect(await findSessionUser(db, session.token, now)).toBeNull();
  });

  it("enforces one agency per creative and cascades sessions when the user is deleted", async () => {
    const user = await registerUser(db, {
      ...credentials,
      email: "owner@example.test",
    });
    await db.agency.create({ data: { ownerId: user.id, name: "Studio One" } });
    await expect(
      db.agency.create({ data: { ownerId: user.id, name: "Studio Two" } }),
    ).rejects.toMatchObject({ code: "P2002" });
    const session = await createSession(db, user.id);
    await db.user.delete({ where: { id: user.id } });
    expect(await findSessionUser(db, session.token)).toBeNull();
    expect(await db.agency.count({ where: { ownerId: user.id } })).toBe(0);
  });

  it("limits attempts across calls and resets only after the window", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let count = 0; count < AUTH_LIMIT; count++)
      await consumeAuthAttempt(db, "limited@example.test", now);
    await expect(
      consumeAuthAttempt(db, "LIMITED@example.test", now),
    ).rejects.toThrow("Too many attempts");
    await expect(
      consumeAuthAttempt(
        db,
        "limited@example.test",
        new Date(now.getTime() + AUTH_WINDOW_MS),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects password truncation and configures httpOnly same-site cookies", () => {
    expect(
      credentialsSchema.safeParse({ ...credentials, password: "é".repeat(37) })
        .success,
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({ ...credentials, password: "short" })
        .success,
    ).toBe(false);
    expect(sessionCookieOptions(new Date())).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
