import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/login/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as draft } from "@/app/api/draft/route";

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
      model: { id: "matchup-swing", selectionStatus: "historical-validated" },
      lineupAvailable: false,
    });
    expect(payload.categoryNeeds).toHaveLength(9);
    expect(payload.recommendations.length).toBeGreaterThan(0);
    expect(payload.recommendations[0]).toMatchObject({
      scoreType: "expected-categories",
      confidence: expect.any(String),
      lineupImpact: { status: "unknown" },
    });
  });

  it("rejects an unauthenticated dashboard request", async () => {
    const response = await dashboard(new Request(
      "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2025-02-14",
    ));
    expect(response.status).toBe(401);
  });

  it("returns a safe validation error for impossible dates and invalid timezones", async () => {
    const loginResponse = await login(new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    }));
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const badDate = await dashboard(new Request(
      "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2025-02-30&timeZone=America%2FNew_York",
      { headers: { cookie } },
    ));
    expect(badDate.status).toBe(400);
    await expect(badDate.json()).resolves.toMatchObject({ error: expect.any(String), requestId: expect.any(String) });

    const badTimeZone = await dashboard(new Request(
      "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2025-02-14&timeZone=Mars%2FOlympus",
      { headers: { cookie } },
    ));
    expect(badTimeZone.status).toBe(400);
    await expect(badTimeZone.json()).resolves.toMatchObject({ error: expect.any(String), requestId: expect.any(String) });
  });

  it("returns a league-specific draft board data source", async () => {
    const loginResponse = await login(new Request("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    }));
    const response = await draft(new Request(
      "http://localhost/api/draft?leagueKey=demo.l.101",
      { headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" } },
    ));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      demoMode: true,
      league: { leagueKey: "demo.l.101" },
      projectionSource: "previous-season",
      model: { id: "dynamic-draft-value", method: "roster-aware-h-score" },
    });
    expect(payload.players.length).toBeGreaterThan(5);
    expect(payload.configuration.categories).toHaveLength(9);
  });
});
