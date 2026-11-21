// X-Forwarded-For is client-controlled except for the entries appended by
// proxies we operate, so only the entry written by the outermost trusted hop
// identifies the client. With no trusted hops configured, there is no client IP.
export function clientIpFromForwardedFor(
  forwardedFor: string | null,
  trustProxyHops: string | undefined,
) {
  const hops = Number(trustProxyHops ?? 0);
  if (!Number.isInteger(hops) || hops < 1 || !forwardedFor) return null;
  const entries = forwardedFor.split(",").map((entry) => entry.trim());
  if (entries.length < hops) return null;
  return entries[entries.length - hops] || null;
}
