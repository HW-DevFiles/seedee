import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, findSessionUser, revokeSession } from "./service";
import { SESSION_COOKIE, sessionCookieOptions } from "./tokens";

// React cache deduplicates within a render, never across users/requests.
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findSessionUser(db, token) : null;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function startSession(userId: string) {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE)?.value;
  if (existing) await revokeSession(db, existing);
  const session = await createSession(db, userId);
  cookieStore.set(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(session.expiresAt),
  );
}

export async function endSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(db, token);
  cookieStore.delete(SESSION_COOKIE);
}
