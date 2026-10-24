import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInjuryAdvice } from "@/lib/injury-service";
import { resetCacheForTests } from "@/lib/cache";
import { getDashboard } from "@/lib/dashboard-service";
import { fetchFreeAgentPool, fetchRoster } from "@/lib/yahoo";
import { fetchYahooXml } from "@/lib/yahoo-client";
import type { DashboardResponse, FreeAgent } from "@/lib/types";
vi.mock("@/lib/dashboard-service", () => ({ getDashboard: vi.fn() }));
vi.mock("@/lib/yahoo-client", () => ({ fetchYahooXml: vi.fn() }));
vi.mock("@/lib/yahoo", async (original) => ({ ...await original<typeof import("@/lib/yahoo")>(), fetchFreeAgentPool: vi.fn(), fetchRoster: vi.fn() }));
const player = (key: string): FreeAgent => ({ playerKey: key, name: key, team: "BOS", position: "PG", status: "", period: "season", stats: {}, statWindows: { lastweek: { "Games Played (GP)": 3, "Minutes Played": 90 }, lastmonth: { "Games Played (GP)": 10, "Minutes Played": 200 } } });
const options = { leagueKey: "nba.l.1", teamKey: "nba.l.1.t.1", week: 1, date: "2026-10-24", timeZone: "America/Los_Angeles", watchKeys: [] as string[] };
const takenXml = '<fantasy_content><players><player><player_key>nba.p.1</player_key><name><full>Star</full></name><editorial_team_abbr>BOS</editorial_team_abbr><display_position>PG</display_position><status>O</status></player><player><player_key>nba.p.3</player_key><name><full>Owned Backup</full></name><editorial_team_abbr>BOS</editorial_team_abbr><display_position>PG</display_position></player></players></fantasy_content>';
beforeEach(() => {
  vi.stubEnv("YAHOO_DEMO_MODE", "false"); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T18:00:00Z")); resetCacheForTests();
  vi.mocked(getDashboard).mockResolvedValue({ league: { gameKey: "nba", currentWeek: 1 }, recommendations: [{ playerKey: "nba.p.2", score: 10, reason: ["AST"] }] } as DashboardResponse);
  vi.mocked(fetchFreeAgentPool).mockResolvedValue({ players: [player("nba.p.2"), player("nba.p.3")], dataQuality: { status: "complete", projectionSource: "current-season", failedWindows: [], warnings: [], stale: false } });
  vi.mocked(fetchRoster).mockResolvedValue({ available: true, players: [player("nba.p.4")] });
  vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
    if (path.includes("status=T")) return takenXml;
    return '<fantasy_content><players><player><player_key>nba.p.1</player_key><player_stats><stats><stat><stat_id>0</stat_id><value>3</value></stat><stat><stat_id>26</stat_id><value>96</value></stat></stats></player_stats></player></players></fantasy_content>';
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("injury advice source aggregation", () => {
  it("includes other managers' injured players and excludes already-owned candidates", async () => {
    const response = await getInjuryAdvice(options);
    expect(response.opportunities.map((item) => item.beneficiaryKey)).toEqual(["nba.p.2"]);
    expect(response.opportunities[0]).toMatchObject({ benefiting: true, score: 10 });
    expect(response.rosterKeys).toEqual(["nba.p.4"]);
    const count = vi.mocked(fetchYahooXml).mock.calls.length;
    await getInjuryAdvice(options);
    expect(fetchYahooXml).toHaveBeenCalledTimes(count);
  });
  it("labels incomplete source data rather than treating absent players as healthy", async () => {
    vi.mocked(fetchYahooXml).mockRejectedValue(new Error("upstream unavailable"));
    const response = await getInjuryAdvice(options);
    expect(response.status).toBe("partial"); expect(response.opportunities).toEqual([]);
  });
  it("does not fetch injury metadata for historical dates or historical weeks", async () => {
    expect((await getInjuryAdvice({ ...options, date: "2026-10-20" })).status).toBe("historical");
    expect((await getInjuryAdvice({ ...options, week: 2 })).status).toBe("historical");
    expect(fetchYahooXml).not.toHaveBeenCalled(); expect(fetchFreeAgentPool).not.toHaveBeenCalled();
  });
  it("requires dated GP records to supply return evidence", async () => {
    vi.mocked(fetchYahooXml).mockImplementation(async (path) => {
      if (path.includes("status=T")) return takenXml.replace('<status>O</status>', '');
      if (path.includes("type=date")) return '<fantasy_content><players><player><player_key>nba.p.1</player_key><player_stats><coverage_type>date</coverage_type><date>2026-10-23</date><stats><stat><stat_id>0</stat_id><value>1</value></stat></stats></player_stats></player></players></fantasy_content>';
      return '<fantasy_content />';
    });
    const response = await getInjuryAdvice({ ...options, watchKeys: ["nba.p.1"] });
    expect(response.players.find((item) => item.playerKey === "nba.p.1")?.playedDates).toEqual(["2026-10-23"]);
  });
});
