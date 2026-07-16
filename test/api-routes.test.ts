import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/login/route";
import { GET as dashboard } from "@/app/api/dashboard/route";

describe("private dashboard API", () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = "test-password";
    process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
    process.env.YAHOO_DEMO_MODE = "true";
  });

  it("sets a secure session and returns the dashboard response shape", async () => {
    const loginResponse = await login(new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    }));
    expect(loginResponse.status).toBe(200);
    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toContain("fantasy_session=");
    expect(cookie).toContain("HttpOnly");

    const response = await dashboard(new Request(
      "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2025-02-14",
      { headers: { cookie: cookie ?? "" } },
    ));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      demoMode: true,
      league: { leagueKey: "demo.l.101" },
      week: 19,
      targetDate: "2025-02-14",
      schedule: { status: "available", source: "demo" },
    });
    expect(payload.categoryNeeds).toHaveLength(9);
    expect(payload.recommendations.length).toBeGreaterThan(0);
  });

  it("rejects an unauthenticated dashboard request", async () => {
    const response = await dashboard(new Request(
      "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2025-02-14",
    ));
    expect(response.status).toBe(401);
  });
});
