import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, type SessionRole } from "@/lib/auth";
import { GET as leagues } from "@/app/api/leagues/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as draft } from "@/app/api/draft/route";
import { GET as details } from "@/app/api/matchup-players/route";
import { GET as injury } from "@/app/api/injury-advice/route";
import { getDashboard, getLeagueSummaries } from "@/lib/dashboard-service";
import { getDraftData } from "@/lib/draft-service";
import { getMatchupPlayers } from "@/lib/matchup-players-service";
import { getInjuryAdvice } from "@/lib/injury-service";
import type { DashboardResponse, DraftDataResponse, LeagueSummary, MatchupPlayersResponse } from "@/lib/types";
import type { InjuryResponse } from "@/lib/injury-types";
vi.mock("@/lib/dashboard-service", () => ({ getDashboard: vi.fn(), getLeagueSummaries: vi.fn() }));
vi.mock("@/lib/draft-service", () => ({ getDraftData: vi.fn() }));
vi.mock("@/lib/matchup-players-service", () => ({ getMatchupPlayers: vi.fn() }));
vi.mock("@/lib/injury-service", () => ({ getInjuryAdvice: vi.fn() }));
const allowed = ["478.l.12355", "478.l.45261"];
const summaries = [...allowed, "478.l.99999"].map((key, index) => ({ leagueKey: key, name: ["廷穎的甜甜圈", "K Town", "Other league"][index] })) as LeagueSummary[];
const request = (role: SessionRole, path: string) => new Request(`http://localhost${path}`, { headers: { cookie: `fantasy_session=${createSessionToken(role)}` } });
const paths = (leagueKey: string) => [
  [`/api/dashboard?leagueKey=${leagueKey}&week=1&date=2026-10-25`, dashboard, getDashboard],
  [`/api/draft?leagueKey=${leagueKey}`, draft, getDraftData],
  [`/api/matchup-players?leagueKey=${leagueKey}&week=1&matchupId=a`, details, getMatchupPlayers],
  [`/api/injury-advice?leagueKey=${leagueKey}&teamKey=${leagueKey}.t.1&week=1&date=2026-10-25`, injury, getInjuryAdvice],
] as const;
beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "fixture-admin-password"); vi.stubEnv("MEMBER_PASSWORD", "fixture-member-password");
  vi.stubEnv("SESSION_SECRET", "role-test-signing-secret-longer-than-32-characters");
  vi.stubEnv("MEMBER_ALLOWED_LEAGUE_KEYS", allowed.join(","));
  vi.mocked(getLeagueSummaries).mockResolvedValue({ leagues: summaries, cached: true, demoMode: false });
  vi.mocked(getDashboard).mockResolvedValue({ league: { leagueKey: "478.l.99999" } } as DashboardResponse);
  vi.mocked(getDraftData).mockResolvedValue({ league: { leagueKey: "478.l.99999" } } as DraftDataResponse);
  vi.mocked(getMatchupPlayers).mockResolvedValue({ leagueKey: "478.l.99999" } as MatchupPlayersResponse);
  vi.mocked(getInjuryAdvice).mockResolvedValue({ leagueKey: "478.l.99999" } as InjuryResponse);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("league authorization before data access", () => {
  it("filters a shared cached league list per request without mutating it", async () => {
    expect((await (await leagues(request("admin", "/api/leagues"))).json()).leagues).toHaveLength(3);
    expect((await (await leagues(request("member", "/api/leagues"))).json()).leagues.map((item: LeagueSummary) => item.leagueKey)).toEqual(allowed);
    expect((await (await leagues(request("admin", "/api/leagues"))).json()).leagues).toHaveLength(3);
    expect(summaries).toHaveLength(3);
  });
  it("denies direct requests to foreign leagues before every loader, including after admin cache warming", async () => {
    for (const [path, route, loader] of paths("478.l.99999")) {
      expect((await route(request("admin", path))).status).toBe(200);
      const count = vi.mocked(loader).mock.calls.length;
      const denied = await route(request("member", path));
      expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(loader).toHaveBeenCalledTimes(count);
    }
  });
  it("allows both member leagues through all data gates and rejects unauthenticated requests", async () => {
    for (const key of allowed) for (const [path, route] of paths(key)) expect((await route(request("member", path))).status).toBe(200);
    for (const [path, route] of paths(allowed[0])) expect((await route(new Request(`http://localhost${path}`))).status).toBe(401);
  });
  it("fails closed with no member whitelist and applies changes to existing sessions", async () => {
    const memberRequest = request("member", `/api/dashboard?leagueKey=${allowed[0]}&week=1&date=2026-10-25`);
    vi.stubEnv("MEMBER_ALLOWED_LEAGUE_KEYS", "");
    expect((await (await leagues(request("member", "/api/leagues"))).json()).leagues).toEqual([]);
    expect((await dashboard(memberRequest)).status).toBe(403);
    expect(getDashboard).not.toHaveBeenCalled();
    vi.stubEnv("MEMBER_ALLOWED_LEAGUE_KEYS", allowed[0]);
    expect((await dashboard(memberRequest)).status).toBe(200);
  });
});
