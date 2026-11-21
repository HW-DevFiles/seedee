import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getCurrentUser: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  registerUser: vi.fn(),
  authenticateUser: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  startSession: mocks.startSession,
  endSession: mocks.endSession,
}));
vi.mock("@/lib/auth/service", () => ({
  registerUser: mocks.registerUser,
  authenticateUser: mocks.authenticateUser,
  AuthError: class extends Error {},
}));

import { signIn, signOut, signUp } from "@/lib/auth/actions";
import { requireSecurityContext } from "@/lib/security/request";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TRUST_PROXY_HOPS", "0");
  mocks.headers.mockResolvedValue(
    new Headers({ host: "localhost:3100", origin: "http://localhost:3100" }),
  );
  mocks.getCurrentUser.mockResolvedValue({ id: "session-owner" });
  mocks.registerUser.mockResolvedValue({ id: "new-owner" });
  mocks.authenticateUser.mockResolvedValue({ id: "existing-owner" });
});
afterEach(() => vi.unstubAllEnvs());

describe("public auth action origin boundary", () => {
  it.each([null, "null", "https://attacker.test"])(
    "blocks all auth side effects for rejected origin %s",
    async (origin) => {
      const headers = new Headers({ host: "localhost:3100" });
      if (origin !== null) headers.set("origin", origin);
      mocks.headers.mockResolvedValue(headers);
      expect(await signUp({}, new FormData())).toEqual({
        error: "This item is unavailable.",
      });
      expect(await signIn({}, new FormData())).toEqual({
        error: "This item is unavailable.",
      });
      await expect(signOut()).rejects.toMatchObject({
        code: "forbidden_or_missing",
      });
      expect(mocks.registerUser).not.toHaveBeenCalled();
      expect(mocks.authenticateUser).not.toHaveBeenCalled();
      expect(mocks.startSession).not.toHaveBeenCalled();
      expect(mocks.endSession).not.toHaveBeenCalled();
    },
  );
  it("allows valid form origins through registration, authentication and revocation", async () => {
    const form = new FormData();
    form.set("email", "test@example.test");
    await signUp({}, form);
    expect(mocks.startSession).toHaveBeenCalledWith("new-owner");
    await signIn({}, form);
    expect(mocks.startSession).toHaveBeenCalledWith("existing-owner");
    await signOut();
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenLastCalledWith("/sign-in");
  });
  it("does not return database exceptions or credentials", async () => {
    mocks.registerUser.mockRejectedValue(
      new Error("database password=session-secret"),
    );
    expect(await signUp({}, new FormData())).toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});

describe("session-derived domain context", () => {
  it("uses session identity, ignores default forwarded IP and rejects revoked/absent sessions", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        host: "localhost:3100",
        origin: "http://localhost:3100",
        "x-user-id": "forged-owner",
        "x-forwarded-for": "192.0.2.55",
      }),
    );
    expect(await requireSecurityContext(true)).toEqual({
      userId: "session-owner",
      clientIp: null,
    });
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireSecurityContext()).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
  it("selects only the explicitly trusted proxy position", async () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "1");
    mocks.headers.mockResolvedValue(
      new Headers({ "x-forwarded-for": "1.2.3.4, 192.0.2.55" }),
    );
    expect(await requireSecurityContext()).toEqual({
      userId: "session-owner",
      clientIp: "192.0.2.55",
    });
  });
});
