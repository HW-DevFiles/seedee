import { createHash, randomBytes } from "node:crypto";

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "seedee_session";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken(now = new Date()) {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_MS),
  };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
