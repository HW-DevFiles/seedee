import { SecurityError } from "./errors";

type RequestHeaders = Pick<Headers, "get">;

function parseOrigin(value: string | null): URL | null {
  if (!value || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

// Route handlers must receive the canonical origin from trusted server config,
// never from a submitted URL or X-Forwarded-* header.
export function assertMutationOrigin(
  headers: RequestHeaders,
  expectedOrigin: string,
) {
  const origin = parseOrigin(headers.get("origin"));
  const expected = parseOrigin(expectedOrigin);
  const site = headers.get("sec-fetch-site");
  if (
    !origin ||
    !expected ||
    origin.origin !== expected.origin ||
    (site !== null && site !== "same-origin" && site !== "none")
  )
    throw new SecurityError("forbidden_or_missing");
}

// Additional fail-closed check for Server Actions, whose framework check permits
// missing Origin. Preserve Host through a proxy; forwarded host is never trusted.
export function assertActionOrigin(
  headers: RequestHeaders,
  production: boolean,
) {
  const origin = parseOrigin(headers.get("origin"));
  const host = headers.get("host");
  if (
    !origin ||
    !host ||
    origin.host.toLowerCase() !== host.toLowerCase() ||
    (production && origin.protocol !== "https:")
  )
    throw new SecurityError("forbidden_or_missing");
  assertMutationOrigin(headers, origin.origin);
}
