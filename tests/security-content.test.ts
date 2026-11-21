import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  csvCell,
  externalUrlSchema,
  markdownText,
  safeExternalUrl,
  serializeCsv,
} from "@/lib/security/content";
import {
  SecurityError,
  safeError,
  securityLogEvent,
} from "@/lib/security/errors";
import {
  assertActionOrigin,
  assertMutationOrigin,
} from "@/lib/security/origin";
import { clientIpFromForwardedFor } from "@/lib/auth/client-ip";
import { sessionCookieOptions } from "@/lib/auth/tokens";
import {
  MAX_EXPORT_BYTES,
  privateDownloadResponse,
  privateErrorResponse,
} from "@/lib/security/exports";

afterEach(() => vi.unstubAllEnvs());

describe("content and private export boundaries", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "http://example.test",
    "//example.test",
    "https://user:secret@example.test",
    "https://example.test\n.evil.test",
    "https:\\evil.test",
    "https://example.test/a b",
    "",
    "https://example.test/" + "a".repeat(2048),
  ])("rejects unsafe reference %s", (value) => {
    expect(safeExternalUrl(value)).toBeNull();
    expect(externalUrlSchema.safeParse(value).success).toBe(false);
  });
  it("canonicalizes HTTPS references without fetching them", () => {
    const fetch = vi.fn(() => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(
        externalUrlSchema.parse("https://Example.test/source?q=one#note"),
      ).toBe("https://example.test/source?q=one#note");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("escapes user HTML and Markdown while React renders user fields as text", () => {
    const attack =
      '<img src=x onerror="alert(1)"> [click](javascript:alert(1))';
    expect(markdownText(attack)).toBe(
      '&lt;img src=x onerror="alert\\(1\\)"&gt; ' +
        "\\[click\\]\\(javascript:alert\\(1\\)\\)",
    );
    expect(markdownText("&#60;script>\n# Heading\n```raw```")).toBe(
      "&amp;\\#60;script&gt;\n\\# Heading\n\\`\\`\\`raw\\`\\`\\`",
    );
    const rendered = renderToStaticMarkup(createElement("p", null, attack));
    expect(rendered).toContain("&lt;img");
    expect(rendered).not.toContain("<img");
  });
  it.each([
    '=HYPERLINK("https://example.test")',
    "+SUM(1,2)",
    "-1+2",
    "@SUM(A1)",
    "\t=1+1",
    "\r=1+1",
    "\u0000=1+1",
    "\ufeff=1+1",
    "   =1+1",
  ])("neutralizes spreadsheet formula text %s", (value) => {
    expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });
  it("preserves CSV quoting, null/zero and explicitly typed numbers", () => {
    expect(
      serializeCsv([["A,B", 'a"b', "line\nbreak", null, 0, -42, false]]),
    ).toBe('"A,B","a""b","line\nbreak","","0","-42","false"\r\n');
    expect(() => csvCell(Infinity)).toThrow();
  });
  it("serves fixed attachment names with private no-store and no executable content", async () => {
    const response = privateDownloadResponse(
      "<script>raw</script>",
      "markdown",
    );
    expect(await response.text()).toBe("<script>raw</script>");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="seedee-preparation.md"',
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(
      privateDownloadResponse("x", "csv").headers.get("Content-Type"),
    ).toBe("text/csv; charset=utf-8");
    expect(() =>
      privateDownloadResponse("é".repeat(MAX_EXPORT_BYTES), "csv"),
    ).toThrow();
  });
  it("returns safe errors and log records with no exception or validation data", async () => {
    const secret = "token-and-password-MUST-NOT-APPEAR";
    for (const error of [
      new Error(secret),
      { message: secret, password: secret },
      z
        .string()
        .refine(() => false, secret)
        .safeParse(secret).error,
    ]) {
      expect(JSON.stringify(safeError(error))).not.toContain(secret);
      expect(JSON.stringify(securityLogEvent("mutation", error))).not.toContain(
        secret,
      );
      const response = privateErrorResponse(error);
      expect(await response.text()).not.toContain(secret);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
    const limit = privateErrorResponse(new SecurityError("rate_limited", 17));
    expect(limit.status).toBe(429);
    expect(limit.headers.get("Retry-After")).toBe("17");
  });
});

describe("mutation origin, cookie and proxy policy", () => {
  it.each([
    null,
    "null",
    "https://attacker.test",
    "https://example.test.attacker.test",
    "http://example.test",
    "https://example.test/path",
    "https://example.test/#hash",
    "https://u:p@example.test",
    "https://example.test\\@evil.test",
  ])("rejects absent, malformed or cross-origin request %s", (origin) => {
    const headers = new Headers({
      host: "example.test",
      "x-forwarded-host": "attacker.test",
    });
    if (origin !== null) headers.set("origin", origin);
    expect(() => assertMutationOrigin(headers, "https://example.test")).toThrow(
      SecurityError,
    );
    expect(() => assertActionOrigin(headers, true)).toThrow(SecurityError);
  });
  it("accepts same-origin forms and rejects a forged forwarding header and same-site siblings", () => {
    const headers = new Headers({
      host: "example.test",
      origin: "https://example.test",
      "sec-fetch-site": "same-origin",
    });
    expect(() => assertActionOrigin(headers, true)).not.toThrow();
    headers.set("sec-fetch-site", "same-site");
    expect(() => assertActionOrigin(headers, true)).toThrow();
    headers.set("sec-fetch-site", "cross-site");
    expect(() =>
      assertMutationOrigin(headers, "https://example.test"),
    ).toThrow();
    headers.delete("sec-fetch-site");
    headers.set("origin", "https://attacker.test");
    headers.set("x-forwarded-host", "attacker.test");
    expect(() => assertActionOrigin(headers, true)).toThrow();
    expect(() =>
      assertActionOrigin(
        new Headers({
          host: "localhost:3100",
          origin: "http://localhost:3100",
        }),
        false,
      ),
    ).not.toThrow();
  });
  it("makes production cookies secure, fixed-expiry, HTTP-only and same-site", () => {
    const expires = new Date("2027-01-01T00:00:00Z");
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(expires)).toEqual({
      expires,
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
  it("rejects non-IP and scoped forwarding values and canonicalizes equivalent IPv6", () => {
    for (const value of [
      "garbage",
      "example.test",
      "1.2.3.4:443",
      "fe80::1%en0",
      "1.2.3.999",
    ])
      expect(clientIpFromForwardedFor(value, "1")).toBeNull();
    expect(clientIpFromForwardedFor("2001:0DB8:0:0:0:0:0:1", "1")).toBe(
      "2001:db8::1",
    );
    expect(clientIpFromForwardedFor("2001:db8::1", "0")).toBeNull();
    expect(clientIpFromForwardedFor("attacker, 192.0.2.1, 10.0.0.1", "2")).toBe(
      "192.0.2.1",
    );
  });
});
