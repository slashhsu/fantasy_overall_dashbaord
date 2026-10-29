import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/login/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as matchupPlayers } from "@/app/api/matchup-players/route";
import { GET as injuryAdvice } from "@/app/api/injury-advice/route";
import { todayInTimeZone } from "@/lib/date-time";
import { GET as draft } from "@/app/api/draft/route";

describe("private dashboard API", () => {
  beforeEach(() => {
    process.env.APP_PASSWORD = "test-password";
    process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
    process.env.YAHOO_DEMO_MODE = "true";
  });

  it("authenticates injury advice, validates watch IDs and returns a demo source", async () => {
    expect((await injuryAdvice(new Request("http://localhost/api/injury-advice"))).status).toBe(401);
    const session = await login(new Request("http://localhost/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) }));
    const headers = { cookie: session.headers.get("set-cookie") ?? "" };
    const params = new URLSearchParams({ leagueKey: "demo.l.101", teamKey: "demo.l.101.t.1", week: "19", date: todayInTimeZone("America/Los_Angeles"), timeZone: "America/Los_Angeles" });
    const response = await injuryAdvice(new Request(`http://localhost/api/injury-advice?${params}`, { headers }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "complete", demoMode: true, opportunities: [expect.objectContaining({ benefiting: true })] });
    params.set("watch", "invalid-id");
    expect((await injuryAdvice(new Request(`http://localhost/api/injury-advice?${params}`, { headers }))).status).toBe(400);
  });

  it("protects player history and validates its requested matchup", async () => {
    expect((await matchupPlayers(new Request("http://localhost/api/matchup-players?leagueKey=demo.l.101&week=19&matchupId=foreign"))).status).toBe(401);
    const session = await login(new Request("http://localhost/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) }));
    const cookie = session.headers.get("set-cookie") ?? "";
    expect((await matchupPlayers(new Request("http://localhost/api/matchup-players?leagueKey=demo.l.101&week=19&matchupId=foreign", { headers: { cookie } }))).status).toBe(400);
  });

  it("validates recommendation horizons and preserves daily as the API default", async () => {
    const session = await login(new Request("http://localhost/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password" }) }));
    const headers = { cookie: session.headers.get("set-cookie") ?? "" };
    const base = "http://localhost/api/dashboard?leagueKey=demo.l.101&week=19&date=2030-01-01";
    expect((await dashboard(new Request(`${base}&recommendationHorizon=bad`, { headers }))).status).toBe(400);
    expect(await (await dashboard(new Request(base, { headers }))).json()).toMatchObject({ recommendationHorizon: "daily" });
    expect(await (await dashboard(new Request(`${base}&recommendationHorizon=remaining-week`, { headers }))).json()).toMatchObject({ recommendationHorizon: "remaining-week", recommendations: [], recommendationPeriod: { status: "complete" } });
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
