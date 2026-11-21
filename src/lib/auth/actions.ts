"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { authenticateUser, AuthError, registerUser } from "./service";
import { clientIpFromForwardedFor } from "./client-ip";
import { endSession, startSession } from "./session";
import type { AuthState } from "./validation";
import { requireMutationOrigin } from "@/lib/security/request";
import { SecurityError, safeError } from "@/lib/security/errors";

async function clientIp() {
  return clientIpFromForwardedFor(
    (await headers()).get("x-forwarded-for"),
    process.env.TRUST_PROXY_HOPS,
  );
}

function errorState(error: unknown): AuthState {
  if (error instanceof SecurityError)
    return { error: safeError(error).message };
  if (error instanceof ZodError)
    return { error: error.issues[0]?.message ?? "Check your details." };
  if (error instanceof AuthError) return { error: error.message };
  // Keep database errors and credentials out of the response and logs.
  return { error: "Something went wrong. Please try again." };
}

export async function signUp(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    await requireMutationOrigin();
    const user = await registerUser(
      db,
      Object.fromEntries(formData),
      await clientIp(),
    );
    await startSession(user.id);
  } catch (error) {
    return errorState(error);
  }
  redirect("/app");
}

export async function signIn(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    await requireMutationOrigin();
    const user = await authenticateUser(
      db,
      Object.fromEntries(formData),
      await clientIp(),
    );
    await startSession(user.id);
  } catch (error) {
    return errorState(error);
  }
  redirect("/app");
}

export async function signOut() {
  await requireMutationOrigin();
  await endSession();
  redirect("/sign-in");
}
