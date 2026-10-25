import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, readSessionToken, verifySessionToken, getRequestSession } from "@/lib/auth";
import { getAuthConfig } from "@/lib/config";
import { POST as login } from "@/app/api/login/route";
import { resetLoginRateLimitsForTests } from "@/lib/rate-limit";
const secret = "role-test-signing-secret-longer-than-32-characters";
const signed = (body: object) => {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};
beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "fixture-admin-password"); vi.stubEnv("MEMBER_PASSWORD", "fixture-member-password");
  vi.stubEnv("MEMBER_ALLOWED_LEAGUE_KEYS", "478.l.12355,478.l.45261"); vi.stubEnv("SESSION_SECRET", secret);
  resetLoginRateLimitsForTests();
});
afterEach(() => vi.unstubAllEnvs());
describe("role-aware private sessions", () => {
  it.each(["admin", "member"] as const)("signs and verifies a %s role", (role) => {
    const token = createSessionToken(role);
    expect(readSessionToken(token)?.role).toBe(role);
    expect(getRequestSession(new Request("http://localhost", { headers: { cookie: `other=x; fantasy_session=${token}` } }))?.role).toBe(role);
    expect(Buffer.from(token.split(".")[0], "base64url").toString()).not.toContain("password");
  });
  it("rejects old, expired, forged, unknown-role and extra-segment sessions", () => {
    const exp = Math.floor(Date.now() / 1000) + 1000;
    for (const token of [signed({ exp }), signed({ version: 2, role: "owner", exp }), signed({ version: 2, role: "admin", exp: 1 }), `${createSessionToken("admin")}.extra`, createSessionToken("member").replace(/.$/, "!"), undefined]) expect(verifySessionToken(token)).toBe(false);
    const member = createSessionToken("member");
    const promoted = Buffer.from(JSON.stringify({ version: 2, role: "admin", exp })).toString("base64url") + "." + member.split(".")[1];
    expect(verifySessionToken(promoted)).toBe(false);
  });
  it("recognizes both configured passwords without exposing them in login responses", async () => {
    for (const [password, role] of [["fixture-admin-password", "admin"], ["fixture-member-password", "member"]]) {
      const response = await login(new Request("http://localhost/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }));
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")!;
      const token = cookie.split(";")[0].slice("fantasy_session=".length);
      expect(readSessionToken(token)?.role).toBe(role);
      expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=lax");
      expect(JSON.stringify(await response.json())).not.toContain(password);
    }
    const bad = await login(new Request("http://localhost/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }));
    expect(bad.status).toBe(401);
  });
  it("rejects identical credentials and disables member authentication when removed", () => {
    vi.stubEnv("MEMBER_PASSWORD", "fixture-admin-password"); expect(() => getAuthConfig()).toThrow("must be different");
    vi.stubEnv("MEMBER_PASSWORD", "fixture-member-password"); const token = createSessionToken("member");
    vi.stubEnv("MEMBER_PASSWORD", ""); expect(readSessionToken(token)).toBeNull();
  });
});
