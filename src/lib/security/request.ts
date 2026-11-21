import "server-only";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromForwardedFor } from "@/lib/auth/client-ip";
import { requireIdentity } from "./ownership";
import { assertActionOrigin } from "./origin";

export async function requireMutationOrigin() {
  assertActionOrigin(await headers(), process.env.NODE_ENV === "production");
}

// Service callers may inject identity in tests. HTTP callers must use this
// boundary rather than accepting userId/clientIp in a form or command payload.
export async function requireSecurityContext(mutation = false) {
  if (mutation) await requireMutationOrigin();
  const user = await getCurrentUser();
  const userId = requireIdentity(user?.id);
  const requestHeaders = await headers();
  return {
    userId,
    clientIp: clientIpFromForwardedFor(
      requestHeaders.get("x-forwarded-for"),
      process.env.TRUST_PROXY_HOPS,
    ),
  };
}
